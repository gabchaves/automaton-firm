#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { STYLE, esc } from "./lineage-render.mjs";

const usd = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;
const pnlClass = (c) => (Number(c || 0) > 0 ? "positive" : Number(c || 0) < 0 ? "negative" : "neutral");

function card(label, value, cls = "") {
  return `<section class="metric"><span>${esc(label)}</span><strong class="${cls}">${esc(value)}</strong></section>`;
}

export function renderWalkForwardHTML(summary, results, generatedAt) {
  const s = summary || { windows: 0, profitableWindows: 0, pctProfitable: 0, worstDrawdownCents: 0, totalPnlCents: 0 };
  const resList = results || [];

  const cards = `<div class="metrics">
    ${card("Janelas testadas", s.windows)}
    ${card("Janelas lucrativas", s.profitableWindows)}
    ${card("% lucrativas", `${s.pctProfitable.toFixed(1)}%`, s.pctProfitable >= 50 ? "positive" : "negative")}
    ${card("Pior drawdown", usd(s.worstDrawdownCents), "negative")}
    ${card("PnL total acumulado", usd(s.totalPnlCents), pnlClass(s.totalPnlCents))}
  </div>`;

  const rows = resList
    .map((r) => {
      const statusIcon = r.profitable ? "✔" : "✖";
      const statusClass = r.profitable ? "positive" : "negative";
      return `<tr>
        <td><strong>${esc(r.label)}</strong></td>
        <td>${esc(r.bars)}</td>
        <td class="${pnlClass(r.totalPnlCents)}">${usd(r.totalPnlCents)}</td>
        <td class="negative">${usd(r.worstDrawdownCents)}</td>
        <td class="${statusClass}" style="text-align:center; font-weight:bold">${statusIcon}</td>
      </tr>`;
    })
    .join("\n");

  const table = `<div class="table-wrap">
    <table>
      <thead><tr><th>Janela</th><th>Bars</th><th>PnL Total</th><th>Pior Drawdown</th><th>Resultado</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Firma de Carry — Walk-Forward Report</title>
<style>${STYLE}</style></head><body>
<main>
  <header><div><h1>📊 Carry Firm — Walk-Forward Robustness</h1>
  <div class="stamp">gerado ${esc(generatedAt)}</div></div></header>
  ${cards}
  <h2>Resultados por Janela Histórica</h2>
  ${table}
  <p class="note">Avaliação multi-regime sobre janelas temporais históricas (bull, bear, consolidação). Inclui mark-to-market basis e custos de taker.</p>
</main>
</body></html>`;
}

function main() {
  const jsonPath = process.argv[2] || path.join(os.homedir(), ".automaton", "walkforward.json");
  const outPath = process.argv[3] || path.resolve(process.cwd(), "walkforward.html");

  if (!fs.existsSync(jsonPath)) {
    console.log(`Walkforward dashboard: json not found at ${jsonPath}. Run the walkforward runner first.`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  fs.writeFileSync(outPath, renderWalkForwardHTML(data.summary, data.results, new Date().toISOString()), "utf8");
  console.log(outPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
