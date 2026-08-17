#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { STYLE, esc } from "./lineage-render.mjs";

const usd = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;
const excessClass = (c) => (Number(c || 0) > 0 ? "positive" : Number(c || 0) < 0 ? "negative" : "neutral");

const VERDICT_LABELS = {
  outperform: "Acima do baseline",
  underperform: "Abaixo do baseline",
  insufficient_evidence: "Evidência insuficiente",
};

const VERDICT_CLASS = {
  outperform: "positive",
  underperform: "negative",
  insufficient_evidence: "neutral",
};

function card(label, value, cls = "") {
  return `<section class="metric"><span>${esc(label)}</span><strong class="${cls}">${esc(value)}</strong></section>`;
}

export function renderHrReportHTML(assessments, generatedAt) {
  const list = assessments || [];

  const body = (() => {
    if (list.length === 0) {
      return '<div class="empty">Nenhuma avaliação registrada ainda.</div>';
    }

    const sorted = [...list].sort((a, b) => Number(b.excessCents || 0) - Number(a.excessCents || 0));
    const outperform = list.filter((a) => a.verdict === "outperform").length;
    const underperform = list.filter((a) => a.verdict === "underperform").length;
    const insufficient = list.filter((a) => a.verdict === "insufficient_evidence").length;

    const cards = `<div class="metrics">
      ${card("Avaliados", list.length)}
      ${card("Acima do baseline", outperform, "positive")}
      ${card("Abaixo do baseline", underperform, "negative")}
      ${card("Evidência insuficiente", insufficient, "neutral")}
    </div>`;

    const rows = sorted
      .map((a) => {
        const label = VERDICT_LABELS[a.verdict] ?? a.verdict;
        const cls = VERDICT_CLASS[a.verdict] ?? "";
        return `<tr>
          <td>${esc(a.traderId ?? a.name ?? "")}</td>
          <td class="${cls}">${esc(label)}</td>
          <td>${usd(a.netCents)}</td>
          <td>${usd(a.baselineMedianCents)}</td>
          <td class="${excessClass(a.excessCents)}">${usd(a.excessCents)}</td>
          <td style="text-align:center">${esc(a.tradesCount ?? "—")}</td>
          <td style="max-width:420px;white-space:normal">${esc(a.reason ?? "")}</td>
        </tr>`;
      })
      .join("\n");

    return `${cards}
    <h2>Avaliações (ordenado por excesso)</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Trader</th><th>Veredito</th><th>Net</th><th>Baseline</th><th>Excesso</th><th>Trades</th><th>Motivo</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="note">Veredito medido contra um baseline aleatório na mesma janela — nunca contra lucro absoluto. Ficar parado numa janela que não ofereceu nada não é penalizado. Traders com evidência insuficiente nunca são promovidos nem demitidos.</p>`;
  })();

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HR Baseada em Evidência — Roster</title>
<style>${STYLE}</style></head><body>
<main>
  <header><div><h1>🧾 HR Baseada em Evidência</h1>
  <div class="stamp">gerado ${esc(generatedAt)}</div></div></header>
  ${body}
</main>
</body></html>`;
}

function main() {
  const jsonPath = process.argv[2] || path.join(os.homedir(), ".automaton", "hr-assessments.json");
  const outPath = process.argv[3] || path.resolve(process.cwd(), "reports", "hr-report.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (!fs.existsSync(jsonPath)) {
    console.log(`HR report: assessments not found at ${jsonPath}. Run evidence-based HR first.`);
    return;
  }

  const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  const generatedAt = parsed.generatedAt || new Date().toISOString();
  const assessments = parsed.assessments || [];
  fs.writeFileSync(outPath, renderHrReportHTML(assessments, generatedAt), "utf8");
  console.log(outPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
