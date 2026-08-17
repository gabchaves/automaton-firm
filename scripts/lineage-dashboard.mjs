#!/usr/bin/env node
/**
 * Renders the CEO strategy-evolution lineage to a self-contained HTML file.
 * Reads generation records (one JSON per line) written incrementally by the
 * evolution runner, so it works even for a partial/interrupted run.
 *
 *   node scripts/lineage-dashboard.mjs [lineage.jsonl] [out.html]
 *
 * Defaults: ~/.automaton/evolution-lineage.jsonl -> ./evolution-lineage.html
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const jsonlPath = process.argv[2] || path.join(os.homedir(), ".automaton", "evolution-lineage.jsonl");
const outPath = process.argv[3] || path.resolve(process.cwd(), "evolution-lineage.html");

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const usd = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;

let records = [];
if (fs.existsSync(jsonlPath)) {
  for (const line of fs.readFileSync(jsonlPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { records.push(JSON.parse(t)); } catch { /* skip partial trailing line */ }
  }
}

const anyKept = records.some((r) => r.keptAsIncumbent);
const rows = records.map((r) => {
  const e = r.evalResult || {};
  const pnl = Number(e.realizedPnlCents || 0);
  const pnlColor = pnl > 0 ? "#1a7f37" : pnl < 0 ? "#cf222e" : "#57606a";
  const kept = r.keptAsIncumbent
    ? '<span style="color:#1a7f37;font-weight:600">ADOTADA</span>'
    : '<span style="color:#57606a">descartada</span>';
  return `<tr>
    <td>${esc(r.generation)}</td>
    <td><code>${esc(r.strategySkill)}</code></td>
    <td style="color:${pnlColor};font-weight:600">${usd(pnl)}</td>
    <td>${usd(e.maxDrawdownCents || 0)}</td>
    <td style="text-align:center">${esc(e.closedTrades ?? "—")}</td>
    <td>${kept}</td>
    <td style="max-width:520px">${esc(r.verdictReason || "")}</td>
  </tr>`;
}).join("\n");

const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Linhagem de Estratégias — Firma Autônoma</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 2rem auto; max-width: 1100px; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; margin-bottom: .25rem; }
  .sub { color: #57606a; margin-top: 0; font-size: .9rem; }
  .verdict { padding: .75rem 1rem; border-radius: 8px; margin: 1rem 0; font-weight: 600; }
  .win { background: #dafbe1; color: #1a7f37; }
  .flat { background: #fff1e5; color: #9a6700; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  th, td { border-bottom: 1px solid #d0d7de; padding: .5rem .6rem; text-align: left; vertical-align: top; }
  th { background: #f6f8fa; font-weight: 600; }
  code { background: #eaeef2; padding: .1rem .35rem; border-radius: 4px; }
  .empty { color: #57606a; font-style: italic; padding: 2rem 0; }
</style></head><body>
<h1>🧬 Linhagem de Estratégias — Firma Autônoma de Trading</h1>
<p class="sub">CEO evolui a própria estratégia · avaliação out-of-sample · gerado ${new Date().toISOString()}</p>
${records.length === 0
  ? '<p class="empty">Nenhuma geração registrada ainda.</p>'
  : `<div class="verdict ${anyKept ? "win" : "flat"}">${anyKept
      ? "✅ Alguma geração bateu a base out-of-sample e foi adotada."
      : "➖ Nenhuma geração bateu a base out-of-sample — a base se manteve (resultado válido e honesto)."}</div>
<table>
  <thead><tr><th>Ger.</th><th>Estratégia</th><th>PnL out-of-sample</th><th>Max DD</th><th>Trades</th><th>Status</th><th>Veredito</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`}
<p class="sub" style="margin-top:1.5rem">${records.length} geração(ões) registrada(s). PnL é realizado sobre a janela de avaliação (dados que a estratégia não viu no treino).</p>
</body></html>`;

fs.writeFileSync(outPath, html, "utf8");
console.log(outPath);
console.log(`generations: ${records.length}, anyKept: ${anyKept}`);
