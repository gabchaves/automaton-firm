#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { STYLE, esc } from "./lineage-render.mjs";

const usd = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

function card(label, value, cls = "") {
  return `<section class="metric"><span>${esc(label)}</span><strong class="${cls}">${esc(value)}</strong></section>`;
}

function cohortRow(c) {
  return `<tr>
    <td><strong>${esc(c.label)}</strong></td>
    <td>${esc(c.traders)}</td>
    <td class="negative">${pct(c.ruinRatePct)}</td>
    <td class="${c.winRatePct >= 50 ? "positive" : "negative"}">${pct(c.winRatePct)}</td>
    <td>${usd(c.medianFinalEquityCents)}</td>
    <td>${usd(c.p10FinalEquityCents)}</td>
    <td>${usd(c.p90FinalEquityCents)}</td>
    <td>${esc(c.medianBarsSurvived)}</td>
  </tr>`;
}

export function renderResilienceHTML(result, generatedAt) {
  const r = result || {
    trials: 0,
    windowBars: 0,
    startCents: 0,
    smart: null,
    random: null,
    pairedWinPct: 0,
    verdict: "",
  };

  const skillDemonstrated = /skill demonstrated/i.test(r.verdict || "");
  const veredictoLabel = skillDemonstrated
    ? "Habilidade demonstrada"
    : "Habilidade não confirmada (ruído/sorte)";
  const veredictoClass = skillDemonstrated ? "positive" : "neutral";

  const ruinCompareClass =
    r.smart && r.random ? (r.smart.ruinRatePct < r.random.ruinRatePct ? "positive" : "negative") : "neutral";

  const cards = `<div class="metrics">
    ${card("Veredito", veredictoLabel, veredictoClass)}
    ${card("Paired win % (vs 50% base)", pct(r.pairedWinPct), r.pairedWinPct >= 60 ? "positive" : r.pairedWinPct <= 40 ? "negative" : "neutral")}
    ${card("Ruína: inteligente vs aleatória", `${pct(r.smart?.ruinRatePct)} vs ${pct(r.random?.ruinRatePct)}`, ruinCompareClass)}
    ${card("Trials", r.trials)}
  </div>`;

  const verdictBanner = `<div class="verdict ${skillDemonstrated ? "win" : "flat"}">
    ${skillDemonstrated ? "✅" : "➖"} ${esc(r.verdict)}
  </div>`;

  const table =
    r.smart && r.random
      ? `<div class="table-wrap">
    <table>
      <thead><tr><th>Cohort</th><th>Traders</th><th>% Ruína</th><th>% Acima do Capital Inicial</th><th>Mediana Equity Final</th><th>P10</th><th>P90</th><th>Mediana Barras Sobrevividas</th></tr></thead>
      <tbody>${cohortRow(r.smart)}${cohortRow(r.random)}</tbody>
    </table>
  </div>`
      : `<div class="empty">Sem dados de cohort.</div>`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Resilience Lab — Habilidade vs Sorte</title>
<style>${STYLE}</style></head><body>
<main>
  <header><div><h1>🧪 Resilience Lab — Habilidade vs Sorte sob Alto Risco</h1>
  <div class="stamp">gerado ${esc(generatedAt)} · ${esc(r.trials)} trials · janela de ${esc(r.windowBars)} bars · capital inicial ${usd(r.startCents)}</div></div></header>
  ${cards}
  ${verdictBanner}
  <h2>Comparação por Cohort</h2>
  ${table}
  <p class="note">
    <strong>Regra de decisão pré-registrada (decidida antes de qualquer resultado):</strong> o cohort inteligente só demonstra habilidade se, em ≥ 200 trials, bater o cohort aleatório em taxa de vitória pareada ≥ 60% E tiver uma taxa de ruína menor. Uma taxa de vitória pareada entre 45–55% é ruído estatístico e deve ser reportada como "nenhuma habilidade detectada", nunca como vitória.<br/>
    <strong>Por que alavancagem:</strong> a alavancagem é usada de propósito para tornar a ruína alcançável — o mecanismo de morte da firma é exatamente o primitivo de risco sendo testado, não algo escondido.<br/>
    <strong>Ressalvas:</strong> esta é uma simulação em papel (paper trading) com taxa fixa por trade; slippage e funding não são modelados.
  </p>
</main>
</body></html>`;
}

function main() {
  const jsonPath = process.argv[2] || path.join(os.homedir(), ".automaton", "resilience.json");
  const outDir = path.resolve(process.cwd(), "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = process.argv[3] || path.join(outDir, "resilience.html");

  if (!fs.existsSync(jsonPath)) {
    console.log(`Resilience dashboard: json not found at ${jsonPath}. Run the resilience gated runner first.`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  fs.writeFileSync(outPath, renderResilienceHTML(data, data.generatedAt || new Date().toISOString()), "utf8");
  console.log(outPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
