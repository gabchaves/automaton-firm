/**
 * Robustness sweep: replays the SAME backtest.mjs machinery (runBacktest)
 * across several DISJOINT historical windows instead of just "the last N
 * days ending now" — the question being asked is not "did the firm win
 * once" but "does the edge measured on one window survive being replayed
 * on windows it never saw."
 *
 * Windows are non-overlapping by construction (each ends where the next
 * begins) so they are independent draws, not the same data resliced. No
 * window here is chosen after seeing its result — the list is fixed before
 * any run executes, exactly the "pre-registered" discipline
 * docs/TRADING-RESEARCH.md's honesty guards require.
 *
 * Reports BOTH the peak-equity edge (the "recorde geral" backtest.mjs
 * already prints) and the final-equity-at-window-end edge, because peak is
 * a running-maximum statistic — it can only go up over a longer or noisier
 * run, so comparing peaks alone systematically flatters whichever cohort
 * had more chances to spike. Final equity is a fairer apples-to-apples
 * comparison of where the money actually ended up.
 *
 * --llm adds the llm-governed cohort (CEO/HR/CFO agents) to every window,
 * sharing ONE SpendCap across the whole sweep — the cap bounds the sweep's
 * TOTAL spend, not each window independently. Opt-in only; real (small)
 * inference cost. See createLlmDeps in backtest.mjs and
 * docs/superpowers/specs/2026-08-20-motor-executive-agents-design.md.
 *
 * Uso: node scripts/backtest-sweep.mjs [--windows 6] [--days 90] [--llm] [--llm-cap 0.5]
 * Requer Node 22 (better-sqlite3) — same as backtest.mjs.
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { runBacktest, createLlmDeps } from "./backtest.mjs";
import { SpendCap } from "../dist/motor/llm-agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MS_PER_DAY = 86_400_000;
const GEN_START_MC = 100_000_000; // $1,000.00

function parseArgs(argv) {
  const get = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i === -1 ? fallback : argv[i + 1];
  };
  const has = (flag) => argv.includes(flag);
  return {
    windows: Number(get("--windows", "6")),
    days: Number(get("--days", "90")),
    llm: has("--llm"),
    llmCapUsd: Number(get("--llm-cap", "0.5")),
  };
}

function buildWindows(count, days) {
  const nowMs = Date.now();
  const windows = [];
  for (let i = 0; i < count; i++) {
    const endMs = nowMs - i * days * MS_PER_DAY;
    windows.push({ label: `W${i} (${i === 0 ? "mais recente" : `${i * days}d atras`})`, days, endMs });
  }
  return windows.reverse(); // oldest first, for a readable chronological table
}

function edgePct(evolvedMc, randomMc) {
  return ((evolvedMc - randomMc) / GEN_START_MC) * 100;
}

function annualize(pct, days) {
  return pct * (365 / days);
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

async function main() {
  const { windows: windowCount, days, llm, llmCapUsd } = parseArgs(process.argv.slice(2));
  const windows = buildWindows(windowCount, days);

  console.log(`[sweep] ${windowCount} janelas disjuntas de ${days} dias cada (${windowCount * days} dias no total, nao sobrepostas)`);
  // ONE SpendCap shared by every window below — bounds the sweep's TOTAL
  // spend, not each window independently (a per-window cap would let total
  // spend scale with windowCount, defeating the point of a hard ceiling).
  const spendCap = llm ? new SpendCap(llmCapUsd) : null;
  const llmDepsTemplate = llm ? createLlmDeps(llmCapUsd, spendCap) : null;
  if (llm) console.log(`[sweep] --llm ativo: teto de gasto COMPARTILHADO entre todas as janelas: $${llmCapUsd.toFixed(2)}`);
  console.log("");

  const results = [];
  for (const w of windows) {
    process.stderr.write(`[sweep] rodando ${w.label}... `);
    const dbPath = path.join(__dirname, "..", ".backtest", `sweep-${w.endMs}.db`);
    const result = await runBacktest({ days: w.days, endMs: w.endMs, dbPath, log: () => {}, llmDeps: llmDepsTemplate });
    process.stderr.write(`ok (${result.barsProcessed} barras${llm ? `, gasto acumulado $${spendCap.spentUsd.toFixed(4)}` : ""})\n`);
    results.push({ label: w.label, ...result });
  }

  console.log("");
  console.log("=== SWEEP — edge por janela (evoluida - controle, % do capital inicial $1.000) ===");
  console.log("");
  const rows = results.map((r) => {
    const peakEdgePct = edgePct(r.evolvedRecordMc, r.randomRecordMc);
    const finalEdgePct = edgePct(r.evolvedFinalMc, r.randomFinalMc);
    const llmPeakEdgePct = r.llmGoverned ? edgePct(r.llmRecordMc, r.randomRecordMc) : null;
    const llmFinalEdgePct = r.llmGoverned ? edgePct(r.llmFinalMc, r.randomFinalMc) : null;
    const llmVsEvolvedPeakPct = r.llmGoverned ? edgePct(r.llmRecordMc, r.evolvedRecordMc) : null;
    return {
      label: r.label,
      start: new Date(r.startMs).toISOString().slice(0, 10),
      end: new Date(r.endMs).toISOString().slice(0, 10),
      peakEdgePct,
      finalEdgePct,
      evolvedGens: r.evolvedGens.length,
      randomGens: r.randomGens.length,
      llmGoverned: r.llmGoverned,
      llmPeakEdgePct, llmFinalEdgePct, llmVsEvolvedPeakPct,
      llmGens: r.llmGoverned ? r.llmGens.length : null,
    };
  });

  for (const row of rows) {
    console.log(
      `${row.label.padEnd(24)} ${row.start} -> ${row.end}  peak-edge ${row.peakEdgePct >= 0 ? "+" : ""}${row.peakEdgePct.toFixed(2)}%  final-edge ${row.finalEdgePct >= 0 ? "+" : ""}${row.finalEdgePct.toFixed(2)}%  (gens: firma ${row.evolvedGens}, controle ${row.randomGens})`,
    );
    if (row.llmGoverned) {
      console.log(
        `${"".padEnd(24)}   llm-governed vs controle: peak-edge ${row.llmPeakEdgePct >= 0 ? "+" : ""}${row.llmPeakEdgePct.toFixed(2)}%  final-edge ${row.llmFinalEdgePct >= 0 ? "+" : ""}${row.llmFinalEdgePct.toFixed(2)}%  |  vs firma (mecanica): ${row.llmVsEvolvedPeakPct >= 0 ? "+" : ""}${row.llmVsEvolvedPeakPct.toFixed(2)}pp  (gens: ${row.llmGens})`,
      );
    }
  }

  const peakEdges = rows.map((r) => r.peakEdgePct);
  const finalEdges = rows.map((r) => r.finalEdgePct);
  const peakWinRate = peakEdges.filter((e) => e > 0).length / peakEdges.length;
  const finalWinRate = finalEdges.filter((e) => e > 0).length / finalEdges.length;

  console.log("");
  console.log("=== AGREGADO ===");
  console.log(`peak-edge:  media ${mean(peakEdges).toFixed(2)}% (~${annualize(mean(peakEdges), days).toFixed(2)}%/ano), desvio-padrao ${stdev(peakEdges).toFixed(2)}pp, firma venceu em ${(peakWinRate * 100).toFixed(0)}% das janelas`);
  console.log(`final-edge: media ${mean(finalEdges).toFixed(2)}% (~${annualize(mean(finalEdges), days).toFixed(2)}%/ano), desvio-padrao ${stdev(finalEdges).toFixed(2)}pp, firma venceu em ${(finalWinRate * 100).toFixed(0)}% das janelas`);

  if (llm) {
    const llmPeakEdges = rows.map((r) => r.llmPeakEdgePct).filter((v) => v !== null);
    const llmFinalEdges = rows.map((r) => r.llmFinalEdgePct).filter((v) => v !== null);
    const llmVsEvolved = rows.map((r) => r.llmVsEvolvedPeakPct).filter((v) => v !== null);
    const llmPeakWinRate = llmPeakEdges.filter((e) => e > 0).length / llmPeakEdges.length;
    const llmVsEvolvedWinRate = llmVsEvolved.filter((e) => e > 0).length / llmVsEvolved.length;
    console.log("");
    console.log(`llm-governed peak-edge vs controle:  media ${mean(llmPeakEdges).toFixed(2)}% (~${annualize(mean(llmPeakEdges), days).toFixed(2)}%/ano), desvio-padrao ${stdev(llmPeakEdges).toFixed(2)}pp, venceu em ${(llmPeakWinRate * 100).toFixed(0)}% das janelas`);
    console.log(`llm-governed final-edge vs controle: media ${mean(llmFinalEdges).toFixed(2)}%`);
    console.log(`llm-governed vs firma (mecanica), peak: media ${mean(llmVsEvolved).toFixed(2)}pp, venceu em ${(llmVsEvolvedWinRate * 100).toFixed(0)}% das janelas`);
    console.log(`gasto total de inferencia no sweep: $${spendCap.spentUsd.toFixed(4)} (teto: $${llmCapUsd.toFixed(2)})`);
  }

  console.log("");
  console.log(`N=${windowCount} janelas — amostra pequena, tratar desvio-padrao e win-rate como indicativos, nao como teste de significancia formal.`);

  const outPath = path.join(__dirname, "..", ".backtest", "sweep-results.json");
  fs.writeFileSync(outPath, JSON.stringify({
    windows: rows, days, generatedAt: Date.now(),
    llmSpentUsd: llm ? spendCap.spentUsd : null,
  }, null, 2));
  console.log("");
  console.log(`[sweep] resultado salvo em ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
