/**
 * Historical backtest: runs the SAME deterministic Motor pipeline (genome,
 * HR, evolved vs. random control) against REAL past Binance 5m candles,
 * into a fresh, ISOLATED SQLite file — never touches the live
 * `~/.automaton/motor.db` that Palco reads.
 *
 * This reuses tick()'s existing catch-up path unmodified: tick() always
 * processes every unprocessed bar in one call, one bar at a time, in its
 * own transaction — feeding it months of historical bars in a single call
 * is exactly what live catch-up already does after downtime (see
 * src/__tests__/motor/tick.test.ts's "CATCH-UP EQUIVALENCE" test). No
 * trading logic is duplicated or reimplemented here.
 *
 * A fresh DB's cursor defaults to `nowMs - BOOTSTRAP_MS` (8 dias) — too
 * short for a multi-month backtest, so this script seeds each symbol's
 * cursor to the real backtest start before the first tick() call.
 *
 * This is a standalone RESEARCH artifact, explicitly separate from the
 * live "dados virgens" track record — its output must always be reported
 * as a backtest, never conflated with the live firm's history.
 *
 * The window end defaults to now, but --end accepts an ISO date or epoch ms
 * so the SAME machinery can replay any historical window — needed to check
 * whether a measured edge holds across regimes instead of one lucky window.
 * There is no separate RNG "seed" knob: every genome/decider seed in this
 * codebase is a deterministic hash of (genNumber, bar timestamp, slot) —
 * see src/motor/cohort.ts's hashSeed — so a different WINDOW is the only way
 * to get a genuinely different, still fully reproducible, draw.
 *
 * --llm adds a THIRD cohort (llm-governed) governed by the CEO/HR/CFO LLM
 * agents (see docs/superpowers/specs/2026-08-20-motor-executive-agents-design.md)
 * — opt-in only, since it spends real (small) inference cost. --llm-cap
 * (default $0.50) is a hard ceiling on that spend for a single run of this
 * script; scripts/backtest-sweep.mjs shares ONE cap across all its windows
 * instead of resetting it per window.
 *
 * Uso: node scripts/backtest.mjs [--days 90] [--end 2026-05-01] [--db path/to/backtest.db] [--json out.json] [--quiet] [--llm] [--llm-cap 0.5]
 * Requer Node 22+ (better-sqlite3).
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openMotorDb } from "../dist/motor/db.js";
import { tick } from "../dist/motor/tick.js";
import { createLlmClient, isLlmAvailable, SpendCap } from "../dist/motor/llm-agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const MS_PER_DAY = 86_400_000;
const BAR_MS = 300_000;
const GEN_START_MC = 100_000_000; // $1,000.00 — keep in sync with src/motor/cohort.ts

function parseArgs(argv) {
  const get = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i === -1 ? fallback : argv[i + 1];
  };
  const has = (flag) => argv.includes(flag);
  const endRaw = get("--end", null);
  return {
    days: Number(get("--days", "90")),
    endMs: endRaw === null ? Date.now() : (/^\d+$/.test(endRaw) ? Number(endRaw) : Date.parse(endRaw)),
    dbPath: get("--db", null),
    jsonPath: get("--json", null),
    quiet: has("--quiet"),
    llm: has("--llm"),
    llmCapUsd: Number(get("--llm-cap", "0.5")),
  };
}

const DEFAULT_PROVIDER_CONFIG_PATH = path.join(
  process.env.HOME ?? process.env.USERPROFILE ?? os.homedir(),
  ".automaton", "inference-providers.json",
);

/**
 * Opt-in only (--llm) — real inference cost, however small. `spendCap` is
 * shared across every window a caller runs (backtest-sweep.mjs constructs
 * ONE and passes it into every window's runBacktest call) so the cap
 * bounds the TOTAL spend of a multi-window sweep, not just one window's.
 */
export function createLlmDeps(llmCapUsd, spendCap, providerConfigPath = DEFAULT_PROVIDER_CONFIG_PATH) {
  if (!isLlmAvailable(providerConfigPath)) {
    throw new Error(
      `--llm requerido mas nenhum provider de inferencia resolve (checado em ${providerConfigPath}). ` +
      `Configure ~/.automaton/inference-providers.json e exporte a API key antes de rodar com --llm.`,
    );
  }
  return {
    providerConfigPath,
    client: createLlmClient(providerConfigPath),
    spendCap: spendCap ?? new SpendCap(llmCapUsd),
  };
}

function fmtUsd(mc) {
  return `$${(mc / 100_000).toFixed(2)}`;
}

function generationSummary(raw, cohort) {
  return raw
    .prepare(
      `SELECT gen_number AS genNumber, started_at AS startedAt, ended_at AS endedAt,
              peak_equity_mc AS peakEquityMc, bars_lived AS barsLived, seed_note AS seedNote
       FROM generations WHERE cohort = ? ORDER BY gen_number ASC`,
    )
    .all(cohort);
}

function latestEquityMc(raw, cohort) {
  const row = raw
    .prepare(`SELECT equity_mc AS equityMc FROM equity_snapshots WHERE cohort = ? ORDER BY ts DESC LIMIT 1`)
    .get(cohort);
  return row ? row.equityMc : GEN_START_MC;
}

/**
 * Core backtest runner, reused by the CLI entrypoint below and by
 * scripts/backtest-sweep.mjs to replay several windows in one process.
 * Returns a plain-data summary — no console output — so callers decide how
 * (or whether) to print it.
 */
export async function runBacktest({ days, endMs, dbPath, log = () => {}, llmDeps = null }) {
  const nowMs = endMs;
  const startMs = nowMs - days * MS_PER_DAY;
  const resolvedDbPath = dbPath ?? path.join(__dirname, "..", ".backtest", `backtest-${Date.now()}.db`);

  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  // A previous run's leftover DB at the same path would let tick() "catch
  // up" from where that run's cursor stopped instead of from startMs,
  // silently truncating this window — always start from a clean file.
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${resolvedDbPath}${suffix}`, { force: true });
  }

  const db = openMotorDb(resolvedDbPath);
  for (const symbol of SYMBOLS) {
    db.setCursor(symbol, startMs - BAR_MS);
  }

  const report = await tick({ db, nowMs, log, llmDeps: llmDeps ?? undefined });

  const evolvedGens = generationSummary(db.raw, "evolved");
  const randomGens = generationSummary(db.raw, "random");
  const evolvedLive = db.getLiveGeneration("evolved");
  const randomLive = db.getLiveGeneration("random");
  const evolvedRecordMc = Math.max(db.getBestEndedRecordMc("evolved"), evolvedLive?.peakEquityMc ?? 0);
  const randomRecordMc = Math.max(db.getBestEndedRecordMc("random"), randomLive?.peakEquityMc ?? 0);
  const evolvedFinalMc = latestEquityMc(db.raw, "evolved");
  const randomFinalMc = latestEquityMc(db.raw, "random");

  const llmGoverned = db.getLiveGeneration("llm-governed") !== null || generationSummary(db.raw, "llm-governed").length > 0;
  const llmGens = llmGoverned ? generationSummary(db.raw, "llm-governed") : [];
  const llmLive = llmGoverned ? db.getLiveGeneration("llm-governed") : null;
  const llmRecordMc = llmGoverned ? Math.max(db.getBestEndedRecordMc("llm-governed"), llmLive?.peakEquityMc ?? 0) : null;
  const llmFinalMc = llmGoverned ? latestEquityMc(db.raw, "llm-governed") : null;

  db.close();

  return {
    days, startMs, endMs: nowMs, dbPath: resolvedDbPath,
    barsProcessed: report.barsProcessed,
    evolvedGens, randomGens,
    evolvedRecordMc, randomRecordMc,
    evolvedFinalMc, randomFinalMc,
    llmGoverned, llmGens, llmRecordMc, llmFinalMc,
    llmSpentUsd: llmDeps ? llmDeps.spendCap.spentUsd : null,
  };
}

function printReport(result) {
  const {
    days, startMs, endMs, dbPath, barsProcessed, evolvedGens, randomGens, evolvedRecordMc, randomRecordMc,
    evolvedFinalMc, randomFinalMc, llmGoverned, llmGens, llmRecordMc, llmFinalMc, llmSpentUsd,
  } = result;

  console.log(`[backtest] janela: ${new Date(startMs).toISOString()} -> ${new Date(endMs).toISOString()} (${days} dias)`);
  console.log(`[backtest] db isolado (nao e o motor.db ao vivo): ${dbPath}`);
  console.log(`[backtest] barras processadas: ${barsProcessed}`);
  console.log("");
  console.log(`=== BACKTEST — ${days} dias de candle real (Binance, 5m, BTC/ETH/SOL) ===`);
  console.log(`Este e um backtest calculado agora, NAO um historico ao vivo. Nao confundir com "dados virgens".`);
  console.log("");
  console.log(`Firma (evoluida): ${evolvedGens.length} geracao(oes)`);
  for (const g of evolvedGens) {
    const status = g.endedAt ? "encerrada" : "viva";
    console.log(`  geracao ${g.genNumber}: pico ${fmtUsd(g.peakEquityMc)}, ${g.barsLived} barras, ${status} (${g.seedNote})`);
  }
  console.log(`  recorde geral (pico): ${fmtUsd(evolvedRecordMc)}`);
  console.log(`  equity final da janela: ${fmtUsd(evolvedFinalMc)}`);
  console.log("");
  console.log(`Controle (aleatorio): ${randomGens.length} geracao(oes)`);
  for (const g of randomGens) {
    const status = g.endedAt ? "encerrada" : "viva";
    console.log(`  geracao ${g.genNumber}: pico ${fmtUsd(g.peakEquityMc)}, ${g.barsLived} barras, ${status} (${g.seedNote})`);
  }
  console.log(`  recorde geral (pico): ${fmtUsd(randomRecordMc)}`);
  console.log(`  equity final da janela: ${fmtUsd(randomFinalMc)}`);
  console.log("");
  console.log(`Resultado (pico): firma ${evolvedRecordMc > randomRecordMc ? "bateu" : "NAO bateu"} o controle aleatorio neste backtest.`);
  console.log(`Resultado (equity final): firma ${evolvedFinalMc > randomFinalMc ? "bateu" : "NAO bateu"} o controle aleatorio neste backtest.`);

  if (llmGoverned) {
    console.log("");
    console.log(`Firma (llm-governed, CEO/RH/CFO): ${llmGens.length} geracao(oes)`);
    for (const g of llmGens) {
      const status = g.endedAt ? "encerrada" : "viva";
      console.log(`  geracao ${g.genNumber}: pico ${fmtUsd(g.peakEquityMc)}, ${g.barsLived} barras, ${status} (${g.seedNote})`);
    }
    console.log(`  recorde geral (pico): ${fmtUsd(llmRecordMc)}`);
    console.log(`  equity final da janela: ${fmtUsd(llmFinalMc)}`);
    console.log(`  gasto real de inferencia nesta janela: $${llmSpentUsd?.toFixed(4) ?? "0.0000"}`);
    console.log("");
    console.log(`Resultado (pico): llm-governed ${llmRecordMc > randomRecordMc ? "bateu" : "NAO bateu"} o controle aleatorio.`);
    console.log(`Resultado (pico): llm-governed ${llmRecordMc > evolvedRecordMc ? "bateu" : "NAO bateu"} a firma evoluida (mecanica).`);
  }
}

async function main() {
  const { days, endMs, dbPath, jsonPath, quiet, llm, llmCapUsd } = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(endMs)) {
    throw new Error(`--end invalido: nao parseou como data nem epoch ms`);
  }

  if (!quiet) {
    console.log(`[backtest] buscando candles reais na Binance e processando... (pode levar alguns minutos)`);
    if (llm) console.log(`[backtest] --llm ativo: teto de gasto $${llmCapUsd.toFixed(2)}`);
  }

  const llmDeps = llm ? createLlmDeps(llmCapUsd) : null;

  const result = await runBacktest({
    days, endMs, dbPath, llmDeps,
    log: quiet ? () => {} : (l) => console.error(`[backtest] ${l}`),
  });

  if (!quiet) printReport(result);
  if (jsonPath) {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
