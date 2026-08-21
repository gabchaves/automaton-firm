/**
 * Pre-registered out-of-sample validation of a single rule, discovered
 * POST-HOC while investigating the LLM executive agents (see
 * docs/TRADING-RESEARCH.md, "LLM executive agents: CEO / HR / CFO"):
 *
 *   RULE: rule-based HR (decideHrActions, no LLM), reviewing every 3 days
 *   instead of daily, deploying a FIXED 30% of the reserve per review
 *   instead of 100%.
 *
 * That rule was found by comparing against `evolved` on the SAME 6 windows
 * used to discover it — a classic overfitting risk (N=6, post-hoc, not
 * pre-registered on the data it was measured against). This script is the
 * honest follow-up: test it on NEW windows it has never touched.
 *
 * PRE-REGISTERED BEFORE ANY RESULT IS SEEN:
 *   - Windows: the NEXT 6 disjoint 90-day windows further back in time than
 *     the 6 already used to discover the rule (indices 6-11 of the same
 *     buildWindows() sequence backtest-sweep.mjs uses) — genuinely unseen.
 *   - Metric: final-equity edge vs `evolved` (today's default: daily
 *     review, deploy 100%) is the one the rule was found on, so it's the
 *     one being re-tested. Peak-edge is reported alongside as the expected
 *     null control — if peak-edge moves, that's the surprise worth
 *     investigating, not a win.
 *   - Decision rule: the 30%-deploy variant is considered to have HELD UP
 *     only if it wins on final-equity in >= 4 of the 6 new windows.
 *     Anything else is a null result, reported as such, not re-cut into a
 *     "well actually" reading of a different sub-metric.
 *
 * The `evolved`/`random` baseline comes from a REAL runBacktest() call
 * (backtest.mjs, unmodified — the exact same code path every other
 * experiment in this document used, real Binance candles). The
 * conservative-deploy variant re-simulates on the SAME already-fetched bars
 * using the exact production functions (seedGeneration, stepCohortBar,
 * computeHrAssessments, applyHrDecision, decideHrActions) — no LLM, no
 * duplicated trading logic, no extra network calls. A re-simulated `random`
 * is verified byte-identical to the real one before any result is trusted
 * (same check used in the original investigation).
 *
 * Uso: node scripts/deploy-fraction-validation.mjs
 * Requer Node 22 (better-sqlite3).
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { runBacktest } from "./backtest.mjs";
import { openMotorDb } from "../dist/motor/db.js";
import { seedGeneration, stepCohortBar, firmEquityMc, hashSeed } from "../dist/motor/cohort.js";
import { computeHrAssessments, applyHrDecision } from "../dist/motor/hr.js";
import { decideHrActions } from "../dist/trading/hr-evaluation.js";
import { mulberry32 } from "../dist/trading/deciders.js";
import { factory as ulidFactory } from "ulid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MS_PER_DAY = 86_400_000;
const GEN_START_MC = 100_000_000;
const HR_DAY_MS = 86_400_000;
const REVIEW_INTERVAL_MS = 3 * HR_DAY_MS;
const MAX_HISTORY_BARS = 2_400;
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const DEPLOY_FRACTION = 0.3;
const DAYS = 90;
const NEW_WINDOW_INDICES = [6, 7, 8, 9, 10, 11]; // one past the 6 already used to discover the rule

function createMkId(seedTime, scope) {
  let counter = 0;
  return () => {
    counter += 1;
    const prng = mulberry32(hashSeed(seedTime, scope, counter));
    return ulidFactory(prng)(seedTime);
  };
}

function traderEquityMcLocal(t, closeBySymbol) {
  if (t.status === "dead") return 0;
  if (!t.step.inPosition) return t.step.cashMc;
  const price = closeBySymbol.get(t.genome.symbol) ?? t.step.entryPriceCents;
  const unrealizedMc = Math.round(t.step.qty * (price - t.step.entryPriceCents) * 1000);
  return t.step.cashMc + unrealizedMc;
}

/** Re-simulates a "mechanical-conservative" cohort AND a lockstep `random`
 * on bars already fetched into `dbPath` by the real runBacktest() call —
 * zero new network calls, zero LLM. */
function simulateConservative(dbPath) {
  const db = openMotorDb(dbPath);
  const raw = db.raw;
  const timestamps = raw.prepare("SELECT DISTINCT ts FROM bars ORDER BY ts ASC").all().map((r) => r.ts);
  const firstBarTs = timestamps[0];

  const barsBySymbol = new Map();
  for (const s of SYMBOLS) {
    const rows = raw.prepare("SELECT ts, close_cents FROM bars WHERE symbol=? ORDER BY ts ASC").all(s);
    const m = new Map();
    for (const r of rows) m.set(r.ts, r.close_cents);
    barsBySymbol.set(s, m);
  }

  const history = new Map();
  for (const s of SYMBOLS) history.set(s, []);

  const mkIdInit = createMkId(firstBarTs, 0);
  let mechRuntime = seedGeneration({
    cohort: "evolved", genNumber: 1, startedAt: firstBarTs, parentGenomes: null,
    generationId: mkIdInit(), mkId: mkIdInit,
  }).runtime;
  let randomRuntime = seedGeneration({
    cohort: "random", genNumber: 1, startedAt: firstBarTs, parentGenomes: null,
    generationId: mkIdInit(), mkId: mkIdInit,
  }).runtime;

  let peakEquityMc = GEN_START_MC;

  db.tx(() => {
    for (const ts of timestamps) {
      const closeBySymbol = new Map();
      for (const s of SYMBOLS) {
        const close = barsBySymbol.get(s).get(ts);
        if (close !== undefined) {
          closeBySymbol.set(s, close);
          const h = history.get(s);
          h.push(close);
          if (h.length > MAX_HISTORY_BARS) h.shift();
        }
      }

      mechRuntime = stepCohortBar(mechRuntime, ts, history, closeBySymbol).runtime;
      randomRuntime = stepCohortBar(randomRuntime, ts, history, closeBySymbol).runtime;

      for (const t of mechRuntime.traders) {
        if (t.status === "live") db.insertTraderSnapshot(ts, t.id, traderEquityMcLocal(t, closeBySymbol));
      }
      for (const t of randomRuntime.traders) {
        if (t.status === "live") db.insertTraderSnapshot(ts, t.id, traderEquityMcLocal(t, closeBySymbol));
      }

      if (ts % REVIEW_INTERVAL_MS === 0) {
        const { assessments, benchmarkCents } = computeHrAssessments(db, mechRuntime, randomRuntime, ts, closeBySymbol);
        const decision = decideHrActions(assessments);
        const mkId = createMkId(ts, 1);
        const result = applyHrDecision({
          db, evolved: mechRuntime, random: randomRuntime, ts, closeBySymbol, mkId,
          assessments, benchmarkCents, decision, deployFraction: DEPLOY_FRACTION,
        });
        mechRuntime = result.evolved;
      }

      peakEquityMc = Math.max(peakEquityMc, firmEquityMc(mechRuntime, closeBySymbol));
    }
  });

  const lastCloseBySymbol = new Map();
  for (const s of SYMBOLS) {
    const rows = barsBySymbol.get(s);
    const lastTs = Math.max(...rows.keys());
    lastCloseBySymbol.set(s, rows.get(lastTs));
  }
  const finalMc = firmEquityMc(mechRuntime, lastCloseBySymbol);
  const randomFinalMc = firmEquityMc(randomRuntime, lastCloseBySymbol);
  const realRandomFinal = raw.prepare(
    "SELECT equity_mc FROM equity_snapshots WHERE cohort='random' ORDER BY ts DESC LIMIT 1",
  ).get()?.equity_mc;

  db.close();
  return { finalMc, peakEquityMc, randomFinalMc, realRandomFinal };
}

function buildWindows(indices, days) {
  const nowMs = Date.now();
  return indices.map((i) => ({
    label: `W${i} (${i * days}d-${(i + 1) * days}d atras)`,
    days, endMs: nowMs - i * days * MS_PER_DAY,
  })).reverse();
}

function edgePct(a, b) {
  return ((a - b) / GEN_START_MC) * 100;
}

async function main() {
  console.log("=== VALIDACAO OUT-OF-SAMPLE: deployFraction=0.3, RH a cada 3 dias ===");
  console.log(`Regra pre-registrada: vitoria em equity final em >= 4/6 janelas NOVAS = regra se sustenta.`);
  console.log(`Janelas: indices ${NEW_WINDOW_INDICES.join(",")} (nunca vistas por essa regra ate agora).`);
  console.log("");

  const windows = buildWindows(NEW_WINDOW_INDICES, DAYS);
  const rows = [];

  for (const w of windows) {
    process.stderr.write(`[validation] rodando ${w.label}... `);
    const dbPath = path.join(__dirname, "..", ".backtest", `deploy-fraction-${w.endMs}.db`);
    const baseline = await runBacktest({ days: w.days, endMs: w.endMs, dbPath, log: () => {} });
    const conservative = simulateConservative(dbPath);
    const reSimOk = conservative.randomFinalMc === conservative.realRandomFinal;
    process.stderr.write(`ok (${baseline.barsProcessed} barras, re-sim random ok? ${reSimOk})\n`);

    rows.push({
      label: w.label,
      start: new Date(baseline.startMs).toISOString().slice(0, 10),
      end: new Date(baseline.endMs).toISOString().slice(0, 10),
      evolvedFinalMc: baseline.evolvedFinalMc,
      evolvedRecordMc: baseline.evolvedRecordMc,
      conservativeFinalMc: conservative.finalMc,
      conservativePeakMc: conservative.peakEquityMc,
      finalEdgePct: edgePct(conservative.finalMc, baseline.evolvedFinalMc),
      peakEdgePct: edgePct(conservative.peakEquityMc, baseline.evolvedRecordMc),
      reSimOk,
    });
  }

  console.log("");
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(28)} ${r.start} -> ${r.end}  final-edge (conservador - evolved) ${r.finalEdgePct >= 0 ? "+" : ""}${r.finalEdgePct.toFixed(2)}%  peak-edge ${r.peakEdgePct >= 0 ? "+" : ""}${r.peakEdgePct.toFixed(2)}%  (re-sim ok: ${r.reSimOk})`,
    );
  }

  const wins = rows.filter((r) => r.finalEdgePct > 0).length;
  const finalEdges = rows.map((r) => r.finalEdgePct);
  const peakEdges = rows.map((r) => r.peakEdgePct);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  console.log("");
  console.log("=== VEREDITO (regra pre-registrada acima) ===");
  console.log(`vitorias em final-edge: ${wins}/6`);
  console.log(`final-edge media: ${mean(finalEdges).toFixed(2)}%`);
  console.log(`peak-edge media: ${mean(peakEdges).toFixed(2)}% (esperado: ~0, controle de que nao e sinal)`);
  console.log("");
  console.log(wins >= 4
    ? "REGRA SE SUSTENTOU no criterio pre-registrado (>=4/6)."
    : "REGRA NAO SE SUSTENTOU no criterio pre-registrado (<4/6) — provavelmente era ajuste ao ruido das 6 janelas originais.");

  const outPath = path.join(__dirname, "..", ".backtest", "deploy-fraction-validation-results.json");
  fs.writeFileSync(outPath, JSON.stringify({ rows, wins, generatedAt: Date.now() }, null, 2));
  console.log("");
  console.log(`[validation] resultado salvo em ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
