/**
 * Snapshot assembly for the Palco front: reads-only over motor.db (never
 * writes) and folds the raw rows into one `PalcoSnapshot` the SSE server
 * pushes whole. `nowMs` is a caller-supplied parameter — no `Date.now()`
 * inside this module — so it stays pure and testable against a seeded
 * temp DB.
 */

import type BetterSqlite3 from "better-sqlite3";
import { formatEventPt } from "./palco-format.js";
import { GEN_START_MC, TRADER_START_MC } from "./cohort.js";

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
    genStartMc: number;    // bankroll per generation — the front derives baselines/copy from this
    traderStartMc: number; // stake per trader — the front derives moods/percentages from this
  };
  generations: Array<{
    cohort: string; genNumber: number; peakEquityMc: number;
    barsLived: number; ended: boolean;
  }>; // records chart, both cohorts
  equitySeries: { evolved: [number, number][]; random: [number, number][] }; // [ts, mc], ~400 pts
  leaderboard: Array<{
    traderId: string; name: string; cohort: string; genNumber: number;
    status: string; bookMc: number; realizedPnlMc: number; tradesCount: number;
    symbol: string; leverage: number; genes: string; combinator: string;
    genome: {
      symbol: string; leverage: number; riskFraction: number; combinator: string;
      genes: Array<{ family: string; params: Record<string, number> }>; // family key removed from params
    };
    achievements: string[];
    inPosition: boolean;
    entryPriceCents: number | null;
  }>; // labels, from achievement events
  feed: Array<{ id: number; ts: number; type: string; html: string; payload: Record<string, unknown> }>; // 40 newest, html pre-formatted+escaped
  org: {
    hrPolicy: string; // fixed PT string, see HR_POLICY_PT
    employees: Array<{
      traderId: string; name: string; cohort: string; slot: number;
      status: string; bookMc: number; symbol: string; leverage: number;
      bornAt: number; diedAt: number | null;
      parentTraderId: string | null; parentName: string | null; // from the trader's own trader_hired event
      seedNote: string; // the trader's generation seed_note (per-generation, not per-trader — see report)
    }>; // every trader (any status) of the CURRENT (unended) generations, both cohorts
    history: Array<{ id: number; ts: number; type: string; html: string; payload: Record<string, unknown> }>;
    // trader_hired / trader_fired / trader_promoted / gen_started / gen_ended events
    // belonging to a CURRENT (unended) generation, chronological
  };
}

const MS_PER_DAY = 86_400_000;
const DEFAULT_EQUITY_MC = 100_000_000; // $1,000.00 seed
const MAX_EQUITY_SERIES_POINTS = 400;
const FEED_LIMIT = 40;

const HR_POLICY_PT =
  "RH baseado em evidência: compara cada trader ao benchmark max(controle aleatório, não fazer nada) na mesma janela de 7 dias. Demite só com evidência clara de underperformance; evidência insuficiente nunca demite nem promove.";

const ORG_HISTORY_TYPES = [
  "trader_hired", "trader_fired", "trader_rotated", "trader_promoted", "gen_started", "gen_ended",
];

type Cohort = "evolved" | "random";

interface GenomeGeneRaw {
  family: string;
  [key: string]: unknown;
}

interface GenomeShape {
  symbol: string;
  genes: GenomeGeneRaw[];
  combinator: string;
  leverage: number;
  riskFraction: number;
}

/** Params for a gene, with the `family` discriminator key removed. */
function geneParams(gene: GenomeGeneRaw): Record<string, number> {
  const params: Record<string, number> = {};
  for (const key of Object.keys(gene)) {
    if (key === "family") continue;
    const value = gene[key];
    if (typeof value === "number") params[key] = value;
  }
  return params;
}

function structuredGenome(genome: GenomeShape): PalcoSnapshot["leaderboard"][number]["genome"] {
  return {
    symbol: genome.symbol,
    leverage: genome.leverage,
    riskFraction: genome.riskFraction,
    combinator: genome.combinator,
    genes: genome.genes.map((gene) => ({ family: gene.family, params: geneParams(gene) })),
  };
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
    genStartMc: GEN_START_MC,
    traderStartMc: TRADER_START_MC,
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
              t.genome_json AS genome_json, t.state_json AS state_json
       FROM traders t
       JOIN generations g ON g.id = t.generation_id
       WHERE g.ended_at IS NULL
       ORDER BY t.cohort = 'random', t.status != 'live', t.book_mc DESC`,
    )
    .all() as {
      id: string; name: string; cohort: string; gen_number: number; status: string;
      book_mc: number; realized_pnl_mc: number; trades_count: number; genome_json: string;
      state_json: string;
    }[];

  const achievements = achievementsByTrader(raw);

  return rows.map((row) => {
    const genome = JSON.parse(row.genome_json) as GenomeShape;
    const state = JSON.parse(row.state_json) as { inPosition?: boolean; entryPriceCents?: number };
    return {
      traderId: row.id,
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
      genome: structuredGenome(genome),
      achievements: achievements.get(row.id) ?? [],
      inPosition: state.inPosition === true,
      entryPriceCents: state.inPosition === true ? state.entryPriceCents ?? null : null,
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

  return rows.map((row) => {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    return { id: row.id, ts: row.ts, type: row.type, html: formatEventPt(row.type, payload), payload };
  });
}

function lastEventId(raw: BetterSqlite3.Database): number {
  const row = raw.prepare("SELECT MAX(id) AS m FROM events").get() as { m: number | null };
  return row.m ?? 0;
}

function currentGenerationIds(raw: BetterSqlite3.Database): string[] {
  const rows = raw.prepare("SELECT id FROM generations WHERE ended_at IS NULL").all() as { id: string }[];
  return rows.map((row) => row.id);
}

/** Every trader's name, across all generations — used to resolve a lineage parent that may no longer be "current". */
function allTraderNames(raw: BetterSqlite3.Database): Map<string, string> {
  const rows = raw.prepare("SELECT id, name FROM traders").all() as { id: string; name: string }[];
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** parentTraderId from the trader's OWN trader_hired event (there is exactly one per trader). */
function hiredEventParentId(raw: BetterSqlite3.Database, traderId: string): string | null {
  const row = raw
    .prepare("SELECT payload_json FROM events WHERE type = 'trader_hired' AND trader_id = ? ORDER BY id ASC LIMIT 1")
    .get(traderId) as { payload_json: string } | undefined;
  if (!row) return null;
  const payload = JSON.parse(row.payload_json) as { parentTraderId?: string | null };
  return payload.parentTraderId ?? null;
}

function computeEmployees(raw: BetterSqlite3.Database): PalcoSnapshot["org"]["employees"] {
  const rows = raw
    .prepare(
      `SELECT t.id AS id, t.name AS name, t.cohort AS cohort, t.slot AS slot, t.status AS status,
              t.book_mc AS book_mc, t.genome_json AS genome_json, t.born_at AS born_at, t.died_at AS died_at,
              g.seed_note AS seed_note
       FROM traders t
       JOIN generations g ON g.id = t.generation_id
       WHERE g.ended_at IS NULL
       ORDER BY t.cohort ASC, t.slot ASC`,
    )
    .all() as {
      id: string; name: string; cohort: string; slot: number; status: string; book_mc: number;
      genome_json: string; born_at: number; died_at: number | null; seed_note: string;
    }[];

  const nameById = allTraderNames(raw);

  return rows.map((row) => {
    const genome = JSON.parse(row.genome_json) as GenomeShape;
    const parentTraderId = hiredEventParentId(raw, row.id);
    return {
      traderId: row.id,
      name: row.name,
      cohort: row.cohort,
      slot: row.slot,
      status: row.status,
      bookMc: row.book_mc,
      symbol: genome.symbol,
      leverage: genome.leverage,
      bornAt: row.born_at,
      diedAt: row.died_at,
      parentTraderId,
      parentName: parentTraderId ? nameById.get(parentTraderId) ?? null : null,
      seedNote: row.seed_note,
    };
  });
}

function computeOrgHistory(raw: BetterSqlite3.Database, currentGenIds: string[]): PalcoSnapshot["org"]["history"] {
  if (currentGenIds.length === 0) return [];

  const typePlaceholders = ORG_HISTORY_TYPES.map(() => "?").join(", ");
  const genPlaceholders = currentGenIds.map(() => "?").join(", ");
  const rows = raw
    .prepare(
      `SELECT id, ts, type, payload_json FROM events
       WHERE type IN (${typePlaceholders}) AND generation_id IN (${genPlaceholders})
       ORDER BY ts ASC, id ASC`,
    )
    .all(...ORG_HISTORY_TYPES, ...currentGenIds) as { id: number; ts: number; type: string; payload_json: string }[];

  return rows.map((row) => {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    return { id: row.id, ts: row.ts, type: row.type, html: formatEventPt(row.type, payload), payload };
  });
}

function computeOrg(raw: BetterSqlite3.Database): PalcoSnapshot["org"] {
  return {
    hrPolicy: HR_POLICY_PT,
    employees: computeEmployees(raw),
    history: computeOrgHistory(raw, currentGenerationIds(raw)),
  };
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
    org: computeOrg(raw),
  };
}
