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

export function renderFirmRosterHTML(traders, statsById, generatedAt) {
  const stats = statsById || {};
  const body = (() => {
    if (!traders || traders.length === 0) {
      return '<div class="empty">Nenhum funcionário registrado ainda.</div>';
    }
    const sorted = [...traders].sort((a, b) => {
      const liveA = a.status === "live" ? 0 : 1;
      const liveB = b.status === "live" ? 0 : 1;
      if (liveA !== liveB) return liveA - liveB;
      return (b.realizedPnlCents || 0) - (a.realizedPnlCents || 0);
    });
    const totalPnl = traders.reduce((s, t) => s + (t.realizedPnlCents || 0), 0);
    const totalBook = traders.filter((t) => t.status === "live").reduce((s, t) => s + (t.bookBalanceCents || 0), 0);
    const liveSeniors = traders.filter((t) => t.status === "live" && t.role === "senior").length;
    const liveInterns = traders.filter((t) => t.status === "live" && t.role === "intern").length;
    const dead = traders.filter((t) => t.status === "dead").length;
    const best = sorted.reduce((a, b) => ((b.realizedPnlCents || 0) > (a.realizedPnlCents || 0) ? b : a), sorted[0]);

    const cards = `<div class="metrics">
      ${card("Lucro realizado total", usd(totalPnl), pnlClass(totalPnl))}
      ${card("Seniors vivos", liveSeniors)}
      ${card("Estagiários vivos", liveInterns)}
      ${card("Mortos", dead)}
      ${card("Caixa total (vivos)", usd(totalBook))}
      ${card("Melhor funcionário", `${best.name} · ${usd(best.realizedPnlCents)}`, pnlClass(best.realizedPnlCents))}
    </div>`;

    const rows = sorted
      .map((t) => {
        const st = stats[t.id] || {};
        return `<tr>
          <td>${esc(t.name)}</td>
          <td>${esc(t.role)}</td>
          <td>${esc(t.strategySkill ?? st.archetype ?? "")}</td>
          <td>${esc(t.generation)}</td>
          <td>${esc(t.status)}</td>
          <td>${usd(t.bookBalanceCents)}</td>
          <td class="${pnlClass(t.realizedPnlCents)}">${usd(t.realizedPnlCents)}</td>
          <td style="text-align:center">${esc(st.cycles ?? "—")}</td>
          <td>${usd(st.fundingCents)}</td>
          <td>${usd(st.feesCents)}</td>
          <td>${esc(t.parentId ? String(t.parentId).slice(0, 8) : "")}</td>
        </tr>`;
      })
      .join("\n");

    return `${cards}
    <h2>Funcionários (ordenado por lucro)</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nome</th><th>Papel</th><th>Arquétipo</th><th>Ger.</th><th>Status</th><th>Book</th><th>Lucro realizado</th><th>Ciclos</th><th>Funding</th><th>Taxas</th><th>Pai</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="note">Lucro realizado = funding − taxas por funcionário. Size fixo (metade do book). v1 assume mark≈spot (basis ignorado); a "morte" raramente dispara num carry delta-neutro.</p>`;
  })();

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Firma de Carry — Resultados</title>
<style>${STYLE}</style></head><body>
<main>
  <header><div><h1>🏦 Firma de Carry — Resultados por Funcionário</h1>
  <div class="stamp">gerado ${esc(generatedAt)}</div></div></header>
  ${body}
</main>
</body></html>`;
}

function main() {
  const dbPath = process.argv[2] || path.join(os.homedir(), ".automaton", "carry-firm.db");
  const statsPath = process.argv[3] || path.join(os.homedir(), ".automaton", "carry-firm-stats.json");
  const outPath = process.argv[4] || path.resolve(process.cwd(), "carry-firm.html");

  if (!fs.existsSync(dbPath)) {
    console.log(`Carry firm dashboard: db not found at ${dbPath}. Run the firm first.`);
    return;
  }
  // Lazy import so the render function stays dependency-free for unit tests.
  import("better-sqlite3").then(({ default: Database }) => {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const traders = db.prepare("SELECT * FROM traders").all().map((r) => ({
      id: r.id, name: r.name, role: r.role, parentId: r.parent_id ?? null,
      bookBalanceCents: r.book_balance_cents, status: r.status, generation: r.generation,
      strategySkill: r.strategy_skill ?? null, realizedPnlCents: r.realized_pnl_cents ?? 0,
    }));
    db.close();
    const stats = fs.existsSync(statsPath) ? JSON.parse(fs.readFileSync(statsPath, "utf-8")) : {};
    fs.writeFileSync(outPath, renderFirmRosterHTML(traders, stats, new Date().toISOString()), "utf8");
    console.log(outPath);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
