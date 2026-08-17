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

export function renderSweepHTML(summaries, rows, capitalCents, generatedAt) {
  const sumList = summaries || [];
  const rowList = rows || [];

  if (sumList.length === 0) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Carry Symbol Sweep</title><style>${STYLE}</style></head><body><main><div class="empty">Nenhum dado de sweep encontrado.</div></main></body></html>`;
  }

  const sortedSummaries = [...sumList].sort((a, b) => b.annualizedPct - a.annualizedPct);
  const bestSymbol = sortedSummaries[0];
  const totalTested = sumList.length;
  const noDataCount = sumList.filter((s) => s.windows === 0).length;

  const cards = `<div class="metrics">
    ${card("Melhor símbolo", bestSymbol.symbol, pnlClass(bestSymbol.annualizedPct))}
    ${card("Retorno anualizado (melhor)", `${bestSymbol.annualizedPct.toFixed(1)}%`, pnlClass(bestSymbol.annualizedPct))}
    ${card("Símbolos testados", totalTested)}
    ${card("Sem dados / pulados", noDataCount)}
  </div>`;

  const summaryRows = sortedSummaries
    .map((s) => {
      const skippedStr = s.skippedWindows.length > 0 ? s.skippedWindows.join("; ") : "—";
      return `<tr>
        <td><strong>${esc(s.symbol)}</strong></td>
        <td class="${pnlClass(s.annualizedPct)}" style="font-weight:bold">${s.annualizedPct.toFixed(1)}%</td>
        <td>${s.pctProfitable.toFixed(1)}% (${s.profitableWindows}/${s.windows})</td>
        <td class="${pnlClass(s.totalPnlCents)}">${usd(s.totalPnlCents)}</td>
        <td class="negative">${usd(s.worstDrawdownCents)}</td>
        <td>${esc(s.windows)}</td>
        <td style="color:var(--muted); font-size:12px">${esc(skippedStr)}</td>
      </tr>`;
    })
    .join("\n");

  const summaryTable = `<div class="table-wrap">
    <table>
      <thead><tr><th>Símbolo</th><th>% Anualizado</th><th>% Janelas Lucrativas</th><th>PnL Total</th><th>Pior Drawdown</th><th>Janelas</th><th>Pulados</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>
  </div>`;

  const detailRows = rowList
    .map((r) => {
      if (r.skipped) {
        return `<tr>
          <td><strong>${esc(r.symbol)}</strong></td>
          <td>${esc(r.window)}</td>
          <td>0</td>
          <td style="color:var(--muted)">—</td>
          <td style="color:var(--muted)">—</td>
          <td style="color:var(--muted)">SKIPPED: ${esc(r.skipped)}</td>
        </tr>`;
      }
      return `<tr>
        <td><strong>${esc(r.symbol)}</strong></td>
        <td>${esc(r.window)}</td>
        <td>${esc(r.bars)}</td>
        <td class="${pnlClass(r.totalPnlCents)}">${usd(r.totalPnlCents)}</td>
        <td class="negative">${usd(r.worstDrawdownCents)}</td>
        <td class="${pnlClass(r.totalPnlCents)}">${r.totalPnlCents > 0 ? "✔ Lucro" : "✖ Prejuízo"}</td>
      </tr>`;
    })
    .join("\n");

  const detailTable = `<div class="table-wrap">
    <table>
      <thead><tr><th>Símbolo</th><th>Janela</th><th>Bars</th><th>PnL Total</th><th>Pior Drawdown</th><th>Status</th></tr></thead>
      <tbody>${detailRows}</tbody>
    </table>
  </div>`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Carry Firm — Symbol Sweep Leaderboard</title>
<style>${STYLE}</style></head><body>
<main>
  <header><div><h1>🏆 Carry Firm — Symbol Sweep Leaderboard</h1>
  <div class="stamp">gerado ${esc(generatedAt)} · capital base ${usd(capitalCents)}</div></div></header>
  ${cards}
  <h2>Ranking por Retorno Anualizado</h2>
  ${summaryTable}
  <h2>Detalhamento por Símbolo × Janela</h2>
  ${detailTable}
  <p class="note">
    <strong>Regra de Decisão:</strong> Um símbolo só justifica capital real se o retorno anualizado bater claramente a taxa livre de risco (~4–5%), com alta taxa de janelas lucrativas e drawdown aceitável.<br/>
    <strong>Ressalvas metodológicas:</strong> Taxa taker fixa (15 bps/leg) pode subestimar slippage real em alts de menor liquidez; basis de alts é consideravelmente mais volátil que o de BTC; custos de margem/empréstimo não são modelados. Símbolos que falharam ou sem dados históricos são exibidos explicitamente para evitar viés de sobrevivência.
  </p>
</main>
</body></html>`;
}

function main() {
  const jsonPath = process.argv[2] || path.join(os.homedir(), ".automaton", "carry-sweep.json");
  const outDir = path.resolve(process.cwd(), "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = process.argv[3] || path.join(outDir, "carry-sweep.html");

  if (!fs.existsSync(jsonPath)) {
    console.log(`Carry sweep dashboard: json not found at ${jsonPath}. Run the sweep runner first.`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  fs.writeFileSync(outPath, renderSweepHTML(data.summaries, data.rows, data.capitalCents, data.generatedAt || new Date().toISOString()), "utf8");
  console.log(outPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
