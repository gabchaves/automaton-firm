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

function eraRow(e) {
  if (e.skipped) {
    return `<tr>
      <td><strong>${esc(e.era)}</strong></td>
      <td>${esc(e.populationBefore)}</td>
      <td>${esc(e.survivors)}</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td style="color:var(--muted)">PULADA: ${esc(e.skipped)}</td>
    </tr>`;
  }
  return `<tr>
    <td><strong>${esc(e.era)}</strong></td>
    <td>${esc(e.populationBefore)}</td>
    <td>${esc(e.survivors)}</td>
    <td>${esc(e.eliminated)}</td>
    <td>${esc(e.died)}</td>
    <td>${usd(e.benchmarkCents)}</td>
    <td class="${pnlClass(e.medianNetCents)}">${usd(e.medianNetCents)}</td>
    <td style="color:var(--muted)">—</td>
  </tr>`;
}

export function renderEraHTML(chain, generatedAt) {
  const c = chain || { eras: [], finalPopulation: [], finalComparison: null, verdict: "" };
  const eras = c.eras || [];
  const finalComparison = c.finalComparison || null;
  const finalPopulation = c.finalPopulation || [];

  const survivorsBeatFresh = !!(finalComparison && finalComparison.survivorsBeatFresh);
  const verdictClass = survivorsBeatFresh ? "win" : "flat";
  const verdictIcon = survivorsBeatFresh ? "✅" : "➖";

  const cards = `<div class="metrics">
    ${card("Eras rodadas", eras.length)}
    ${card("População final", finalPopulation.length)}
    ${card("Sobreviventes no ano final", finalComparison ? finalComparison.survivorCount : "—")}
    ${card("Frescos no ano final (controle)", finalComparison ? finalComparison.freshCount : "—")}
    ${card("Veredito", survivorsBeatFresh ? "Sobreviventes venceram" : "Sem vantagem preditiva", survivorsBeatFresh ? "positive" : "neutral")}
  </div>`;

  const eraTable =
    eras.length > 0
      ? `<div class="table-wrap">
    <table>
      <thead><tr><th>Era</th><th>Pop. antes</th><th>Sobreviventes</th><th>Eliminados</th><th>Mortos (ruína)</th><th>Benchmark</th><th>Net mediano</th><th>Motivo (se pulada)</th></tr></thead>
      <tbody>${eras.map(eraRow).join("\n")}</tbody>
    </table>
  </div>`
      : `<div class="empty">Nenhuma era rodada ainda.</div>`;

  const finalBlock = finalComparison
    ? `<div class="table-wrap">
    <table>
      <thead><tr><th>Cohort</th><th>N</th><th>Net mediano</th></tr></thead>
      <tbody>
        <tr><td><strong>Sobreviventes (${esc(eras.length)} era(s) de seleção)</strong></td><td>${esc(finalComparison.survivorCount)}</td><td class="${pnlClass(finalComparison.survivorMedianNetCents)}">${usd(finalComparison.survivorMedianNetCents)}</td></tr>
        <tr><td><strong>Frescos (nunca selecionados)</strong></td><td>${esc(finalComparison.freshCount)}</td><td class="${pnlClass(finalComparison.freshMedianNetCents)}">${usd(finalComparison.freshMedianNetCents)}</td></tr>
      </tbody>
    </table>
  </div>
  <div class="verdict ${verdictClass}">${verdictIcon} ${esc(finalComparison.verdict)}</div>`
    : `<div class="empty">Sem comparação final ainda.</div>`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evolução por Eras — Seleção Encadeada</title>
<style>${STYLE}</style></head><body>
<main>
  <header><div><h1>🧬 Evolução por Eras — Seleção Encadeada no Tempo</h1>
  <div class="stamp">gerado ${esc(generatedAt)}</div></div></header>
  ${cards}
  <h2>Eras (seleção, em ordem cronológica)</h2>
  ${eraTable}
  <h2>Comparação final: sobreviventes vs. população fresca de controle</h2>
  ${finalBlock}
  <p class="note">
    <strong>Sem lookahead:</strong> cada era é julgada apenas com dados posteriores à seleção que produziu sua população — um indivíduo que entra na era N só foi selecionado usando eras anteriores a N. A última era nunca é usada para seleção, apenas para julgar.<br/>
    <strong>Benchmark:</strong> o benchmark de cada era é <code>max(mediana aleatória, não fazer nada)</code> — nunca menos do que simplesmente não operar.<br/>
    <strong>Se os sobreviventes não baterem a população fresca:</strong> a seleção não produziu nenhuma vantagem preditiva. Isso é dito de forma direta aqui, sem suavizar o resultado.
  </p>
</main>
</body></html>`;
}

function main() {
  const jsonPath = process.argv[2] || path.join(os.homedir(), ".automaton", "era-evolution.json");
  const outDir = path.resolve(process.cwd(), "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = process.argv[3] || path.join(outDir, "era-evolution.html");

  if (!fs.existsSync(jsonPath)) {
    console.log(`Era dashboard: json not found at ${jsonPath}. Run the gated era-evolution runner first.`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  fs.writeFileSync(outPath, renderEraHTML(data.chain, data.generatedAt || new Date().toISOString()), "utf8");
  console.log(outPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
