/**
 * Snapshot assembly for the Palco front: reads-only over motor.db (never
 * writes) and folds the raw rows into one `PalcoSnapshot` the SSE server
 * pushes whole. `nowMs` is a caller-supplied parameter — no `Date.now()`
 * inside this module — so it stays pure and testable against a seeded
 * temp DB.
 */

import type BetterSqlite3 from "better-sqlite3";
import { formatEventPt } from "./palco-format.js";

export interface PalcoSnapshot {
  generatedAt: number; // caller-provided nowMs (no Date.now in the module)
  lastEventId: number;
  cards: {
    evolvedEquityMc: number; randomEquityMc: number;
    evolvedGen: number; randomGen: number;
    recordEvolvedMc: number; recordRandomMc: number; // max(ended peaks, live peak)
    gensEvolved: number; gensRandom: number;
    barsProcessed: number; lastBarTs: number | null;
    virginDays: number; // (lastBarTs - min(generations.started_at)) / 86_400_000, 1 decimal
  };
  generations: Array<{
    cohort: string; genNumber: number; peakEquityMc: number;
    barsLived: number; ended: boolean;
  }>; // records chart, both cohorts
  equitySeries: { evolved: [number, number][]; random: [number, number][] }; // [ts, mc], ~400 pts
  leaderboard: Array<{
    name: string; cohort: string; genNumber: number;
    status: string; bookMc: number; realizedPnlMc: number; tradesCount: number;
    symbol: string; leverage: number; genes: string; combinator: string;
    achievements: string[];
  }>; // labels, from achievement events
  feed: Array<{ id: number; ts: number; type: string; html: string }>; // 40 newest, html pre-formatted+escaped
}

const MS_PER_DAY = 86_400_000;
const DEFAULT_EQUITY_MC = 1_000_000;
const MAX_EQUITY_SERIES_POINTS = 400;
const FEED_LIMIT = 40;

type Cohort = "evolved" | "random";

interface GenomeShape {
  symbol: string;
  genes: { family: string }[];
  combinator: string;
  leverage: number;
}

function latestEquityMc(raw: BetterSqlite3.Database, cohort: Cohort): number {
  const row = raw
    .prepare("SELECT equity_mc FROM equity_snapshots WHERE cohort = ? ORDER BY ts DESC LIMIT 1")
    .get(cohort) as { equity_mc: number } | undefined;
  return row ? row.equity_mc : DEFAULT_EQUITY_MC;
}

function liveGeneration(raw: BetterSqlite3.Database, cohort: Cohort): { gen_number: number; peak_equity_mc: number } | undefined {
  return raw
    .prepare("SELECT gen_number, peak_equity_mc FROM generations WHERE cohort = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
    .get(cohort) as { gen_number: number; peak_equity_mc: number } | undefined;
}

function bestEndedPeakMc(raw: BetterSqlite3.Database, cohort: Cohort): number {
  const row = raw
    .prepare("SELECT MAX(peak_equity_mc) AS m FROM generations WHERE cohort = ? AND ended_at IS NOT NULL")
    .get(cohort) as { m: number | null };
  return row.m ?? 0;
}

function generationCount(raw: BetterSqlite3.Database, cohort: Cohort): number {
  const row = raw.prepare("SELECT COUNT(*) AS n FROM generations WHERE cohort = ?").get(cohort) as { n: number };
  return row.n;
}

function computeCards(raw: BetterSqlite3.Database): PalcoSnapshot["cards"] {
  const live: Record<Cohort, ReturnType<typeof liveGeneration>> = {
    evolved: liveGeneration(raw, "evolved"),
    random: liveGeneration(raw, "random"),
  };

  const barsProcessed = (raw.prepare("SELECT COUNT(DISTINCT ts) AS n FROM bars").get() as { n: number }).n;
  const lastBarTsRow = raw.prepare("SELECT MAX(ts) AS t FROM equity_snapshots").get() as { t: number | null };
  const lastBarTs = lastBarTsRow.t ?? null;
  const minStartedAtRow = raw.prepare("SELECT MIN(started_at) AS t FROM generations").get() as { t: number | null };
  const minStartedAt = minStartedAtRow.t ?? null;

  const virginDays = lastBarTs !== null && minStartedAt !== null
    ? Math.round(((lastBarTs - minStartedAt) / MS_PER_DAY) * 10) / 10
    : 0;

  return {
    evolvedEquityMc: latestEquityMc(raw, "evolved"),
    randomEquityMc: latestEquityMc(raw, "random"),
    evolvedGen: live.evolved?.gen_number ?? 0,
    randomGen: live.random?.gen_number ?? 0,
    recordEvolvedMc: Math.max(bestEndedPeakMc(raw, "evolved"), live.evolved?.peak_equity_mc ?? 0),
    recordRandomMc: Math.max(bestEndedPeakMc(raw, "random"), live.random?.peak_equity_mc ?? 0),
    gensEvolved: generationCount(raw, "evolved"),
    gensRandom: generationCount(raw, "random"),
    barsProcessed,
    lastBarTs,
    virginDays,
  };
}

function computeGenerations(raw: BetterSqlite3.Database): PalcoSnapshot["generations"] {
  const rows = raw
    .prepare("SELECT cohort, gen_number, peak_equity_mc, bars_lived, ended_at FROM generations ORDER BY cohort ASC, gen_number ASC")
    .all() as { cohort: string; gen_number: number; peak_equity_mc: number; bars_lived: number; ended_at: number | null }[];

  return rows.map((row) => ({
    cohort: row.cohort,
    genNumber: row.gen_number,
    peakEquityMc: row.peak_equity_mc,
    barsLived: row.bars_lived,
    ended: row.ended_at !== null,
  }));
}

/** Stride downsample to <= MAX_EQUITY_SERIES_POINTS, always ending on the true last row. */
function downsample(rows: [number, number][]): [number, number][] {
  const n = rows.length;
  if (n === 0) return [];
  const stride = Math.max(1, Math.ceil(n / MAX_EQUITY_SERIES_POINTS));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i += stride) out.push(rows[i]);
  out[out.length - 1] = rows[n - 1];
  return out;
}

function equitySeriesFor(raw: BetterSqlite3.Database, cohort: Cohort): [number, number][] {
  const rows = raw
    .prepare("SELECT ts, equity_mc FROM equity_snapshots WHERE cohort = ? ORDER BY ts ASC")
    .all(cohort) as { ts: number; equity_mc: number }[];
  return downsample(rows.map((row): [number, number] => [row.ts, row.equity_mc]));
}

function computeEquitySeries(raw: BetterSqlite3.Database): PalcoSnapshot["equitySeries"] {
  return { evolved: equitySeriesFor(raw, "evolved"), random: equitySeriesFor(raw, "random") };
}

function achievementsByTrader(raw: BetterSqlite3.Database): Map<string, string[]> {
  const rows = raw
    .prepare("SELECT trader_id, payload_json FROM events WHERE type = 'achievement' AND trader_id IS NOT NULL ORDER BY id ASC")
    .all() as { trader_id: string; payload_json: string }[];

  const byTrader = new Map<string, string[]>();
  for (const row of rows) {
    const label = (JSON.parse(row.payload_json) as { label: string }).label;
    const existing = byTrader.get(row.trader_id);
    if (existing) existing.push(label);
    else byTrader.set(row.trader_id, [label]);
  }
  return byTrader;
}

function computeLeaderboard(raw: BetterSqlite3.Database): PalcoSnapshot["leaderboard"] {
  const rows = raw
    .prepare(
      `SELECT t.id AS id, t.name AS name, t.cohort AS cohort, g.gen_number AS gen_number, t.status AS status,
              t.book_mc AS book_mc, t.realized_pnl_mc AS realized_pnl_mc, t.trades_count AS trades_count,
              t.genome_json AS genome_json
       FROM traders t
       JOIN generations g ON g.id = t.generation_id
       WHERE g.ended_at IS NULL
       ORDER BY t.cohort = 'random', t.status != 'live', t.book_mc DESC`,
    )
    .all() as {
      id: string; name: string; cohort: string; gen_number: number; status: string;
      book_mc: number; realized_pnl_mc: number; trades_count: number; genome_json: string;
    }[];

  const achievements = achievementsByTrader(raw);

  return rows.map((row) => {
    const genome = JSON.parse(row.genome_json) as GenomeShape;
    return {
      name: row.name,
      cohort: row.cohort,
      genNumber: row.gen_number,
      status: row.status,
      bookMc: row.book_mc,
      realizedPnlMc: row.realized_pnl_mc,
      tradesCount: row.trades_count,
      symbol: genome.symbol,
      leverage: genome.leverage,
      genes: genome.genes.map((gene) => gene.family).join(" + "),
      combinator: genome.combinator,
      achievements: achievements.get(row.id) ?? [],
    };
  });
}

function computeFeed(raw: BetterSqlite3.Database): PalcoSnapshot["feed"] {
  const rows = raw
    .prepare(
      `SELECT id, ts, type, payload_json FROM events
       WHERE type NOT IN ('motor_started', 'motor_stopped')
       ORDER BY id DESC LIMIT ?`,
    )
    .all(FEED_LIMIT) as { id: number; ts: number; type: string; payload_json: string }[];

  return rows.map((row) => ({
    id: row.id,
    ts: row.ts,
    type: row.type,
    html: formatEventPt(row.type, JSON.parse(row.payload_json) as Record<string, unknown>),
  }));
}

function lastEventId(raw: BetterSqlite3.Database): number {
  const row = raw.prepare("SELECT MAX(id) AS m FROM events").get() as { m: number | null };
  return row.m ?? 0;
}

export function buildSnapshot(raw: BetterSqlite3.Database, nowMs: number): PalcoSnapshot {
  return {
    generatedAt: nowMs,
    lastEventId: lastEventId(raw),
    cards: computeCards(raw),
    generations: computeGenerations(raw),
    equitySeries: computeEquitySeries(raw),
    leaderboard: computeLeaderboard(raw),
    feed: computeFeed(raw),
  };
}
