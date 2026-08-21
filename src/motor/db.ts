/**
 * Motor persistence: a dedicated SQLite file (default ~/.automaton/motor.db).
 * Append-only events table is the contract the future front (Palco) reads.
 * One transaction per processed bar gives tick() its idempotence.
 */

import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { Cohort } from "./cohort.js";

export interface GenerationRow {
  id: string; cohort: Cohort; genNumber: number;
  startedAt: number; endedAt: number | null;
  peakEquityMc: number; peakAt: number; barsLived: number; seedNote: string;
}
export interface TraderRow {
  id: string; generationId: string; slot: number; name: string;
  cohort: Cohort; genomeJson: string; deciderSeed: number;
  stateJson: string; bookMc: number; peakBookMc: number;
  realizedPnlMc: number; tradesCount: number;
  status: "live" | "dead" | "fired"; bornAt: number; diedAt: number | null;
}
export interface EventRow {
  id: number; ts: number; type: string;
  traderId: string | null; generationId: string | null; payloadJson: string;
}
export interface MotorDb {
  raw: import("better-sqlite3").Database;
  tx<T>(fn: () => T): T;
  close(): void;
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
  getCursor(symbol: string): number | null;
  setCursor(symbol: string, ts: number): void;
  insertBars(symbol: string, bars: { ts: number; closeCents: number }[]): void;
  listBars(symbol: string, toTs: number, limit?: number): { ts: number; closeCents: number }[];
  listBarTimestamps(fromTsExclusive: number): number[]; // union across symbols, ascending
  getBarClose(symbol: string, ts: number): number | null;
  insertGeneration(row: GenerationRow): void;
  updateGeneration(id: string, patch: Partial<GenerationRow>): void;
  getLiveGeneration(cohort: Cohort): GenerationRow | null;
  getBestEndedRecordMc(cohort: Cohort): number;
  insertTrader(row: TraderRow): void;
  updateTrader(id: string, patch: Partial<TraderRow>): void;
  listTradersByGeneration(generationId: string): TraderRow[];
  insertEvent(ev: { ts: number; type: string; traderId: string | null; generationId: string | null; payloadJson: string }): void;
  listEvents(fromIdExclusive: number, limit: number): EventRow[];
  hasAchievement(traderId: string, key: string): boolean;
  insertEquitySnapshot(ts: number, cohort: string, equityMc: number): void;
  insertTraderSnapshot(ts: number, traderId: string, equityMc: number): void;
  getTraderEquityAt(traderId: string, ts: number): number | null; // latest snapshot <= ts
  countTradeCloses(traderId: string, fromTs: number, toTs: number): number;
  getLlmDecision(genNumber: number, ts: number, role: LlmRole): LlmDecisionRow | null;
  insertLlmDecision(row: LlmDecisionRow): void;
}

export type LlmRole = "ceo" | "hr" | "cfo";

export interface LlmDecisionRow {
  genNumber: number; ts: number; role: LlmRole;
  decisionJson: string; rawResponse: string;
  providerId: string; modelId: string; costCredits: number; createdAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cursor (symbol TEXT PRIMARY KEY, last_ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bars (
  symbol TEXT NOT NULL, ts INTEGER NOT NULL, close_cents INTEGER NOT NULL,
  PRIMARY KEY (symbol, ts)
);
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY, cohort TEXT NOT NULL, gen_number INTEGER NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER,
  peak_equity_mc INTEGER NOT NULL, peak_at INTEGER NOT NULL,
  bars_lived INTEGER NOT NULL, seed_note TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS traders (
  id TEXT PRIMARY KEY, generation_id TEXT NOT NULL, slot INTEGER NOT NULL,
  name TEXT NOT NULL, cohort TEXT NOT NULL, genome_json TEXT NOT NULL,
  decider_seed INTEGER NOT NULL, state_json TEXT NOT NULL,
  book_mc INTEGER NOT NULL, peak_book_mc INTEGER NOT NULL,
  realized_pnl_mc INTEGER NOT NULL, trades_count INTEGER NOT NULL,
  status TEXT NOT NULL, born_at INTEGER NOT NULL, died_at INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL,
  trader_id TEXT, generation_id TEXT, payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type_trader ON events(type, trader_id);
CREATE TABLE IF NOT EXISTS equity_snapshots (
  ts INTEGER NOT NULL, cohort TEXT NOT NULL, equity_mc INTEGER NOT NULL,
  PRIMARY KEY (ts, cohort)
);
CREATE TABLE IF NOT EXISTS trader_snapshots (
  ts INTEGER NOT NULL, trader_id TEXT NOT NULL, equity_mc INTEGER NOT NULL,
  PRIMARY KEY (ts, trader_id)
);
-- LLM executive-agent decisions (llm-governed cohort only). Keyed by
-- (gen_number, ts, role) rather than generation_id — those two are what
-- stays identical across a replay of the same historical window, so a
-- second run of an already-processed window finds this row and skips
-- inference entirely. See
-- docs/superpowers/specs/2026-08-20-motor-executive-agents-design.md.
CREATE TABLE IF NOT EXISTS llm_decisions (
  gen_number INTEGER NOT NULL, ts INTEGER NOT NULL, role TEXT NOT NULL,
  decision_json TEXT NOT NULL, raw_response TEXT NOT NULL,
  provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
  cost_credits REAL NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (gen_number, ts, role)
);
`;

interface GenerationRowDb {
  id: string; cohort: Cohort; gen_number: number;
  started_at: number; ended_at: number | null;
  peak_equity_mc: number; peak_at: number; bars_lived: number; seed_note: string;
}

interface TraderRowDb {
  id: string; generation_id: string; slot: number; name: string;
  cohort: Cohort; genome_json: string; decider_seed: number;
  state_json: string; book_mc: number; peak_book_mc: number;
  realized_pnl_mc: number; trades_count: number;
  status: "live" | "dead" | "fired"; born_at: number; died_at: number | null;
}

interface EventRowDb {
  id: number; ts: number; type: string;
  trader_id: string | null; generation_id: string | null; payload_json: string;
}

interface LlmDecisionRowDb {
  gen_number: number; ts: number; role: LlmRole;
  decision_json: string; raw_response: string;
  provider_id: string; model_id: string; cost_credits: number; created_at: number;
}

function mapGeneration(row: GenerationRowDb): GenerationRow {
  return {
    id: row.id, cohort: row.cohort, genNumber: row.gen_number,
    startedAt: row.started_at, endedAt: row.ended_at,
    peakEquityMc: row.peak_equity_mc, peakAt: row.peak_at,
    barsLived: row.bars_lived, seedNote: row.seed_note,
  };
}

function mapTrader(row: TraderRowDb): TraderRow {
  return {
    id: row.id, generationId: row.generation_id, slot: row.slot, name: row.name,
    cohort: row.cohort, genomeJson: row.genome_json, deciderSeed: row.decider_seed,
    stateJson: row.state_json, bookMc: row.book_mc, peakBookMc: row.peak_book_mc,
    realizedPnlMc: row.realized_pnl_mc, tradesCount: row.trades_count,
    status: row.status, bornAt: row.born_at, diedAt: row.died_at,
  };
}

function mapEvent(row: EventRowDb): EventRow {
  return {
    id: row.id, ts: row.ts, type: row.type,
    traderId: row.trader_id, generationId: row.generation_id, payloadJson: row.payload_json,
  };
}

function mapLlmDecision(row: LlmDecisionRowDb): LlmDecisionRow {
  return {
    genNumber: row.gen_number, ts: row.ts, role: row.role,
    decisionJson: row.decision_json, rawResponse: row.raw_response,
    providerId: row.provider_id, modelId: row.model_id,
    costCredits: row.cost_credits, createdAt: row.created_at,
  };
}

const GENERATION_COLUMNS: Record<keyof GenerationRow, string> = {
  id: "id", cohort: "cohort", genNumber: "gen_number",
  startedAt: "started_at", endedAt: "ended_at",
  peakEquityMc: "peak_equity_mc", peakAt: "peak_at",
  barsLived: "bars_lived", seedNote: "seed_note",
};

const TRADER_COLUMNS: Record<keyof TraderRow, string> = {
  id: "id", generationId: "generation_id", slot: "slot", name: "name",
  cohort: "cohort", genomeJson: "genome_json", deciderSeed: "decider_seed",
  stateJson: "state_json", bookMc: "book_mc", peakBookMc: "peak_book_mc",
  realizedPnlMc: "realized_pnl_mc", tradesCount: "trades_count",
  status: "status", bornAt: "born_at", diedAt: "died_at",
};

function buildUpdate(
  table: string,
  columns: Record<string, string>,
  patch: Record<string, unknown>,
): { sql: string; values: unknown[] } | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) continue;
    const column = columns[key];
    if (!column) continue;
    sets.push(`${column} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return null;
  return { sql: `UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`, values };
}

export function openMotorDb(dbPath: string): MotorDb {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const raw: BetterSqlite3.Database = new Database(dbPath);
  raw.pragma("journal_mode = WAL");
  raw.exec(SCHEMA);

  const stmts = {
    getMeta: raw.prepare("SELECT value FROM meta WHERE key = ?"),
    setMeta: raw.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)"),
    getCursor: raw.prepare("SELECT last_ts FROM cursor WHERE symbol = ?"),
    setCursor: raw.prepare("INSERT OR REPLACE INTO cursor (symbol, last_ts) VALUES (?, ?)"),
    insertBar: raw.prepare(
      "INSERT OR REPLACE INTO bars (symbol, ts, close_cents) VALUES (?, ?, ?)",
    ),
    listBars: raw.prepare(
      "SELECT ts, close_cents FROM bars WHERE symbol = ? AND ts <= ? ORDER BY ts ASC",
    ),
    listBarsLimit: raw.prepare(
      "SELECT ts, close_cents FROM bars WHERE symbol = ? AND ts <= ? ORDER BY ts DESC LIMIT ?",
    ),
    listBarTimestamps: raw.prepare(
      "SELECT DISTINCT ts FROM bars WHERE ts > ? ORDER BY ts ASC",
    ),
    getBarClose: raw.prepare(
      "SELECT close_cents FROM bars WHERE symbol = ? AND ts = ?",
    ),
    insertGeneration: raw.prepare(
      `INSERT INTO generations
        (id, cohort, gen_number, started_at, ended_at, peak_equity_mc, peak_at, bars_lived, seed_note)
       VALUES (@id, @cohort, @genNumber, @startedAt, @endedAt, @peakEquityMc, @peakAt, @barsLived, @seedNote)`,
    ),
    getLiveGeneration: raw.prepare(
      "SELECT * FROM generations WHERE cohort = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
    ),
    getBestEndedRecordMc: raw.prepare(
      "SELECT MAX(peak_equity_mc) AS best FROM generations WHERE cohort = ? AND ended_at IS NOT NULL",
    ),
    insertTrader: raw.prepare(
      `INSERT INTO traders
        (id, generation_id, slot, name, cohort, genome_json, decider_seed, state_json,
         book_mc, peak_book_mc, realized_pnl_mc, trades_count, status, born_at, died_at)
       VALUES (@id, @generationId, @slot, @name, @cohort, @genomeJson, @deciderSeed, @stateJson,
         @bookMc, @peakBookMc, @realizedPnlMc, @tradesCount, @status, @bornAt, @diedAt)`,
    ),
    listTradersByGeneration: raw.prepare(
      "SELECT * FROM traders WHERE generation_id = ?",
    ),
    insertEvent: raw.prepare(
      `INSERT INTO events (ts, type, trader_id, generation_id, payload_json)
       VALUES (@ts, @type, @traderId, @generationId, @payloadJson)`,
    ),
    listEvents: raw.prepare(
      "SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?",
    ),
    hasAchievement: raw.prepare(
      `SELECT 1 FROM events WHERE type = 'achievement' AND trader_id = ?
       AND json_extract(payload_json, '$.key') = ? LIMIT 1`,
    ),
    insertEquitySnapshot: raw.prepare(
      "INSERT OR REPLACE INTO equity_snapshots (ts, cohort, equity_mc) VALUES (?, ?, ?)",
    ),
    insertTraderSnapshot: raw.prepare(
      "INSERT OR REPLACE INTO trader_snapshots (ts, trader_id, equity_mc) VALUES (?, ?, ?)",
    ),
    getTraderEquityAt: raw.prepare(
      "SELECT equity_mc FROM trader_snapshots WHERE trader_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1",
    ),
    countTradeCloses: raw.prepare(
      `SELECT COUNT(*) AS n FROM events WHERE type = 'trade_closed'
       AND trader_id = ? AND ts > ? AND ts <= ?`,
    ),
    getLlmDecision: raw.prepare(
      "SELECT * FROM llm_decisions WHERE gen_number = ? AND ts = ? AND role = ?",
    ),
    insertLlmDecision: raw.prepare(
      `INSERT INTO llm_decisions
        (gen_number, ts, role, decision_json, raw_response, provider_id, model_id, cost_credits, created_at)
       VALUES (@genNumber, @ts, @role, @decisionJson, @rawResponse, @providerId, @modelId, @costCredits, @createdAt)`,
    ),
  };

  return {
    raw,

    tx<T>(fn: () => T): T {
      return raw.transaction(fn)();
    },

    close(): void {
      raw.close();
    },

    getMeta(key: string): string | null {
      const row = stmts.getMeta.get(key) as { value: string } | undefined;
      return row ? row.value : null;
    },

    setMeta(key: string, value: string): void {
      stmts.setMeta.run(key, value);
    },

    getCursor(symbol: string): number | null {
      const row = stmts.getCursor.get(symbol) as { last_ts: number } | undefined;
      return row ? row.last_ts : null;
    },

    setCursor(symbol: string, ts: number): void {
      stmts.setCursor.run(symbol, ts);
    },

    insertBars(symbol: string, bars: { ts: number; closeCents: number }[]): void {
      for (const bar of bars) {
        stmts.insertBar.run(symbol, bar.ts, bar.closeCents);
      }
    },

    listBars(symbol: string, toTs: number, limit?: number): { ts: number; closeCents: number }[] {
      const rows = (
        limit === undefined
          ? stmts.listBars.all(symbol, toTs)
          : stmts.listBarsLimit.all(symbol, toTs, limit).reverse()
      ) as { ts: number; close_cents: number }[];
      return rows.map((row) => ({ ts: row.ts, closeCents: row.close_cents }));
    },

    listBarTimestamps(fromTsExclusive: number): number[] {
      const rows = stmts.listBarTimestamps.all(fromTsExclusive) as { ts: number }[];
      return rows.map((row) => row.ts);
    },

    getBarClose(symbol: string, ts: number): number | null {
      const row = stmts.getBarClose.get(symbol, ts) as { close_cents: number } | undefined;
      return row ? row.close_cents : null;
    },

    insertGeneration(row: GenerationRow): void {
      stmts.insertGeneration.run(row);
    },

    updateGeneration(id: string, patch: Partial<GenerationRow>): void {
      const update = buildUpdate("generations", GENERATION_COLUMNS, patch);
      if (!update) return;
      raw.prepare(update.sql).run(...update.values, id);
    },

    getLiveGeneration(cohort: Cohort): GenerationRow | null {
      const row = stmts.getLiveGeneration.get(cohort) as GenerationRowDb | undefined;
      return row ? mapGeneration(row) : null;
    },

    getBestEndedRecordMc(cohort: Cohort): number {
      const row = stmts.getBestEndedRecordMc.get(cohort) as { best: number | null };
      return row.best ?? 0;
    },

    insertTrader(row: TraderRow): void {
      stmts.insertTrader.run(row);
    },

    updateTrader(id: string, patch: Partial<TraderRow>): void {
      const update = buildUpdate("traders", TRADER_COLUMNS, patch);
      if (!update) return;
      raw.prepare(update.sql).run(...update.values, id);
    },

    listTradersByGeneration(generationId: string): TraderRow[] {
      const rows = stmts.listTradersByGeneration.all(generationId) as TraderRowDb[];
      return rows.map(mapTrader);
    },

    insertEvent(ev: { ts: number; type: string; traderId: string | null; generationId: string | null; payloadJson: string }): void {
      stmts.insertEvent.run(ev);
    },

    listEvents(fromIdExclusive: number, limit: number): EventRow[] {
      const rows = stmts.listEvents.all(fromIdExclusive, limit) as EventRowDb[];
      return rows.map(mapEvent);
    },

    hasAchievement(traderId: string, key: string): boolean {
      const row = stmts.hasAchievement.get(traderId, key);
      return row !== undefined;
    },

    insertEquitySnapshot(ts: number, cohort: string, equityMc: number): void {
      stmts.insertEquitySnapshot.run(ts, cohort, equityMc);
    },

    insertTraderSnapshot(ts: number, traderId: string, equityMc: number): void {
      stmts.insertTraderSnapshot.run(ts, traderId, equityMc);
    },

    getTraderEquityAt(traderId: string, ts: number): number | null {
      const row = stmts.getTraderEquityAt.get(traderId, ts) as { equity_mc: number } | undefined;
      return row ? row.equity_mc : null;
    },

    countTradeCloses(traderId: string, fromTs: number, toTs: number): number {
      const row = stmts.countTradeCloses.get(traderId, fromTs, toTs) as { n: number };
      return row.n;
    },

    getLlmDecision(genNumber: number, ts: number, role: LlmRole): LlmDecisionRow | null {
      const row = stmts.getLlmDecision.get(genNumber, ts, role) as LlmDecisionRowDb | undefined;
      return row ? mapLlmDecision(row) : null;
    },

    insertLlmDecision(row: LlmDecisionRow): void {
      stmts.insertLlmDecision.run(row);
    },
  };
}
