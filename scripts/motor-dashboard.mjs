#!/usr/bin/env node
/**
 * Motor snapshot dashboard (provisório — o Palco realtime é o próximo
 * sub-projeto). Lê ~/.automaton/motor.db (read-only) e escreve
 * reports/motor-dashboard.html num visual Harvey-flavored: ivory, serifa,
 * verde-floresta, réguas finas.
 *
 * Uso: node scripts/motor-dashboard.mjs [db] [out.html] [--watch]
 * Requer Node 22 (better-sqlite3).
 */

import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

const args = process.argv.slice(2).filter((a) => a !== "--watch");
const watch = process.argv.includes("--watch");
const dbPath = args[0] ?? path.join(os.homedir(), ".automaton", "motor.db");
const outPath = args[1] ?? path.join("reports", "motor-dashboard.html");

const usd = (mc) => `$${(mc / 100_000).toFixed(2)}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const when = (ts) => new Date(ts).toISOString().slice(5, 16).replace("T", " ");

function feedLine(type, p) {
  if (type === "trade_opened") return `abriu ${p.symbol} · notional ${usd(p.notionalMc)}`;
  if (type === "trade_closed") return `fechou ${p.symbol} · P&L ${usd(p.realizedPnlMc)}${p.liquidated ? " · LIQUIDADO" : ""}`;
  if (type === "trader_hired") return `🤝 <strong>${esc(p.name)}</strong> contratado(a) · slot ${p.slot} · stake ${usd(p.stakeMc)}`;
  if (type === "trader_fired") return `📦 <strong>${esc(p.name)}</strong> demitido(a) · devolveu ${usd(p.returnedMc)}<br><small>${esc(p.reason)}</small>`;
  if (type === "trader_died") return `💀 <strong>${esc(p.name)}</strong> morreu · viveu ${(p.ageMs / 3_600_000).toFixed(1)}h · pico ${usd(p.bookPeakMc)}`;
  if (type === "trader_promoted") return `🏆 <strong>${esc(p.name)}</strong> promovido(a) — ${esc(p.title)}`;
  if (type === "achievement") return `✨ <strong>${esc(p.name)}</strong> — "${esc(p.label)}"`;
  if (type === "hr_review") return `🧾 RH: ${p.reviewed} avaliados · ${p.fired} demitidos · ${p.promoted} promovidos · ${p.held} mantidos · benchmark ${p.benchmarkCents}c`;
  if (type === "gen_started") return `🌱 Geração ${p.genNumber} (${p.cohort}) começou — ${esc(p.seedNote)}`;
  if (type === "gen_ended") return `⚰️ Geração ${p.genNumber} (${p.cohort}) acabou · pico ${usd(p.peakEquityMc)} · ${p.daysLived} dias${p.isNewRecord ? " · 🔔 NOVO RECORDE" : ""}`;
  if (type === "record_broken") return `🔔 RECORDE: ${usd(p.peakEquityMc)} (${p.cohort}, gen ${p.genNumber}) — anterior ${usd(p.previousRecordMc)}`;
  if (type === "catch_up") return `⏪ catch-up de ${p.bars} barras`;
  return esc(type);
}

function sparkline(points, width, height, stroke, dash) {
  if (points.length < 2) return "";
  const min = Math.min(...points, 1_000_000);
  const max = Math.max(...points, 1_000_000);
  const span = Math.max(max - min, 1);
  const step = width / (points.length - 1);
  const pts = points.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * (height - 4) - 2).toFixed(1)}`).join(" ");
  const baseY = height - ((1_000_000 - min) / span) * (height - 4) - 2;
  return `<line x1="0" y1="${baseY.toFixed(1)}" x2="${width}" y2="${baseY.toFixed(1)}" stroke="#9a9a8f" stroke-dasharray="4 4" stroke-width="1"/>` +
    `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.8"${dash ? ' stroke-dasharray="2 3"' : ""}/>`;
}

function render() {
  const d = new Database(dbPath, { readonly: true, fileMustExist: true });

  const gens = Object.fromEntries(
    ["evolved", "random"].map((c) => [c, d.prepare("SELECT * FROM generations WHERE cohort = ? AND ended_at IS NULL").get(c)]),
  );
  const record = (c) => {
    const ended = d.prepare("SELECT MAX(peak_equity_mc) m FROM generations WHERE cohort = ? AND ended_at IS NOT NULL").get(c)?.m ?? 0;
    return Math.max(ended, gens[c]?.peak_equity_mc ?? 0);
  };
  const equityNow = Object.fromEntries(
    d.prepare("SELECT cohort, equity_mc FROM equity_snapshots WHERE ts = (SELECT MAX(ts) FROM equity_snapshots)").all()
      .map((r) => [r.cohort, r.equity_mc]),
  );
  const barsN = d.prepare("SELECT COUNT(DISTINCT ts) n FROM bars").get().n;
  const lastTs = d.prepare("SELECT MAX(ts) t FROM equity_snapshots").get().t;
  const genCount = (c) => d.prepare("SELECT COUNT(*) n FROM generations WHERE cohort = ?").get(c).n;

  const series = {};
  for (const c of ["evolved", "random"]) {
    const rows = d.prepare("SELECT equity_mc FROM equity_snapshots WHERE cohort = ? ORDER BY ts").all(c).map((r) => r.equity_mc);
    const stride = Math.max(1, Math.floor(rows.length / 300));
    series[c] = rows.filter((_, i) => i % stride === 0);
  }

  const traders = d.prepare(
    "SELECT t.*, g.cohort AS gcohort, g.gen_number FROM traders t JOIN generations g ON g.id = t.generation_id WHERE g.ended_at IS NULL " +
    "ORDER BY t.cohort = 'random', t.status != 'live', t.book_mc DESC",
  ).all();

  const feed = d.prepare(
    "SELECT ts, type, payload_json FROM events WHERE type NOT IN ('motor_started','motor_stopped') ORDER BY id DESC LIMIT 40",
  ).all();

  const rosterRows = traders.map((t) => {
    const g = JSON.parse(t.genome_json);
    const genes = g.genes.map((x) => x.family).join(" + ");
    const statusPt = t.status === "live" ? "vivo" : t.status === "dead" ? "morto" : "demitido";
    return `<tr class="${t.status}"><td>${esc(t.name)}</td><td>${t.cohort === "evolved" ? "firma" : "controle"}</td>` +
      `<td>G${t.gen_number}</td><td class="st-${t.status}">${statusPt}</td><td class="num">${usd(t.book_mc)}</td>` +
      `<td class="num">${usd(t.realized_pnl_mc)}</td><td class="num">${t.trades_count}</td>` +
      `<td>${esc(g.symbol)} · ${g.leverage}x</td><td class="genes">${esc(genes)} <em>(${esc(g.combinator)})</em></td></tr>`;
  }).join("\n");

  const feedRows = feed.map((e) => {
    const p = JSON.parse(e.payload_json);
    return `<li><span class="ts">${when(e.ts)}</span> ${feedLine(e.type, p)}</li>`;
  }).join("\n");

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="refresh" content="60">
<title>Motor — A Firma</title>
<style>
  :root { --ivory:#f6f4ee; --ink:#232320; --green:#1e3d2f; --green-soft:#2e5c46; --rule:#d8d4c8; --muted:#7a7768; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--ivory); color:var(--ink); font:15px/1.55 Georgia,'Times New Roman',serif; padding:48px clamp(20px,6vw,90px); }
  .label { font-family:Verdana,Geneva,sans-serif; font-size:10px; letter-spacing:.22em; text-transform:uppercase; color:var(--muted); }
  h1 { font-size:clamp(28px,4vw,44px); font-weight:400; color:var(--green); margin:6px 0 2px; }
  .sub { color:var(--muted); font-style:italic; margin-bottom:28px; }
  hr { border:0; border-top:1px solid var(--rule); margin:26px 0; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:0 32px; }
  .card .label { margin-bottom:4px; }
  .card .v { font-size:30px; color:var(--green); }
  .card .d { font-size:12px; color:var(--muted); }
  .cols { display:grid; grid-template-columns:1.5fr 1fr; gap:44px; align-items:start; }
  @media (max-width:900px){ .cols { grid-template-columns:1fr; } }
  h2 { font-size:19px; font-weight:400; color:var(--green); margin-bottom:12px; }
  table { border-collapse:collapse; width:100%; font-size:13.5px; }
  th { text-align:left; font-family:Verdana,sans-serif; font-size:9.5px; letter-spacing:.18em; text-transform:uppercase; color:var(--muted); font-weight:400; padding:6px 10px 6px 0; border-bottom:1px solid var(--ink); }
  td { padding:7px 10px 7px 0; border-bottom:1px solid var(--rule); vertical-align:top; }
  td.num { font-variant-numeric:tabular-nums; }
  tr.dead td, tr.fired td { color:var(--muted); }
  .st-live { color:var(--green-soft); } .st-dead::before { content:"💀 "; } .st-fired::before { content:"📦 "; }
  .genes { font-size:12px; color:var(--muted); }
  ul.feed { list-style:none; }
  ul.feed li { padding:7px 0; border-bottom:1px solid var(--rule); font-size:13.5px; }
  ul.feed .ts { font-family:Verdana,sans-serif; font-size:10px; color:var(--muted); margin-right:8px; }
  ul.feed small { color:var(--muted); }
  .chart-wrap { margin:8px 0 4px; } svg { display:block; width:100%; height:90px; }
  .legend { font-size:11.5px; color:var(--muted); }
  .legend b { color:var(--green); font-weight:400; } .legend s { text-decoration:none; color:#8a8a7d; }
  footer { margin-top:40px; font-size:11.5px; color:var(--muted); font-style:italic; }
</style></head><body>
<div class="label">Automaton · pesquisa de trading · dinheiro de papel</div>
<h1>A Firma</h1>
<div class="sub">Gerações de $10 operando ao vivo na Binance — contra um controle aleatório e contra não fazer nada.</div>

<div class="cards">
  <div class="card"><div class="label">Equity da firma</div><div class="v">${usd(equityNow.evolved ?? 1_000_000)}</div><div class="d">Geração ${gens.evolved?.gen_number ?? "–"}</div></div>
  <div class="card"><div class="label">Controle aleatório</div><div class="v">${usd(equityNow.random ?? 1_000_000)}</div><div class="d">Geração ${gens.random?.gen_number ?? "–"}</div></div>
  <div class="card"><div class="label">Não fazer nada</div><div class="v">$10.00</div><div class="d">o piso honesto</div></div>
  <div class="card"><div class="label">Recorde (pico)</div><div class="v">${usd(record("evolved"))}</div><div class="d">controle: ${usd(record("random"))}</div></div>
  <div class="card"><div class="label">Gerações vividas</div><div class="v">${genCount("evolved")} <small style="font-size:14px;color:var(--muted)">/ ${genCount("random")}</small></div><div class="d">firma / controle</div></div>
</div>

<div class="chart-wrap">
  <svg viewBox="0 0 600 90" preserveAspectRatio="none">
    ${sparkline(series.random, 600, 90, "#8a8a7d", true)}
    ${sparkline(series.evolved, 600, 90, "#1e3d2f", false)}
  </svg>
  <div class="legend"><b>— firma</b> · <s>┄ controle aleatório</s> · ╌ $10 parado &nbsp;·&nbsp; ${barsN} barras de 5m · até ${when(lastTs)} UTC</div>
</div>

<hr>
<div class="cols">
  <div>
    <h2>Quadro de funcionários</h2>
    <table><thead><tr><th>Nome</th><th>Time</th><th>Gen</th><th>Status</th><th>Book</th><th>P&L real.</th><th>Trades</th><th>Mesa</th><th>Genoma</th></tr></thead>
    <tbody>${rosterRows}</tbody></table>
  </div>
  <div>
    <h2>Mural</h2>
    <ul class="feed">${feedRows}</ul>
  </div>
</div>

<footer>Snapshot provisório gerado por scripts/motor-dashboard.mjs — recarrega sozinho a cada 60s (com --watch regerando). O Palco, o front realtime definitivo, é o próximo sub-projeto.</footer>
</body></html>`;

  d.close();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`wrote ${outPath}`);
}

render();
if (watch) setInterval(() => { try { render(); } catch (e) { console.error(`render failed: ${e.message}`); } }, 60_000);
