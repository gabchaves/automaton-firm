/**
 * Pure PT event formatter for the Palco front. Turns a Motor event row
 * (type + payload) into a safe HTML string — every payload value that
 * lands in the output goes through `escapeHtml` first (Global Constraint:
 * "no exceptions"), even fields that only ever hold trusted internal
 * strings today (symbol, cohort, seedNote, ...). No DB, no Date.now(),
 * no Math.random — this module is a pure string mapper.
 */

type Payload = Record<string, unknown>;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function usdFromMc(mc: number): string {
  return `$${(mc / 100_000).toFixed(2)}`;
}

function str(p: Payload, key: string): string {
  return escapeHtml(String(p[key]));
}

function num(p: Payload, key: string): number {
  return Number(p[key]);
}

function usd(p: Payload, key: string): string {
  return usdFromMc(num(p, key));
}

const FORMATTERS: Record<string, (p: Payload) => string> = {
  trade_opened: (p) => `abriu ${str(p, "symbol")} · notional ${usd(p, "notionalMc")}`,

  trade_closed: (p) =>
    `fechou ${str(p, "symbol")} · P&L ${usd(p, "realizedPnlMc")}${p.liquidated ? " · LIQUIDADO" : ""}`,

  trader_hired: (p) =>
    `🤝 <strong>${str(p, "name")}</strong> contratado(a) · slot ${num(p, "slot")} · stake ${usd(p, "stakeMc")}`,

  trader_fired: (p) =>
    `📦 <strong>${str(p, "name")}</strong> demitido(a) · devolveu ${usd(p, "returnedMc")}<br><small>${str(p, "reason")}</small>`,

  trader_died: (p) =>
    `💀 <strong>${str(p, "name")}</strong> morreu · viveu ${(num(p, "ageMs") / 3_600_000).toFixed(1)}h · pico ${usd(p, "bookPeakMc")}`,

  trader_promoted: (p) =>
    `🏆 <strong>${str(p, "name")}</strong> promovido(a) — ${str(p, "title")}`,

  achievement: (p) => `✨ <strong>${str(p, "name")}</strong> — "${str(p, "label")}"`,

  hr_review: (p) =>
    `🧾 RH: ${num(p, "reviewed")} avaliados · ${num(p, "fired")} demitidos · ${num(p, "promoted")} promovidos · ${num(p, "held")} mantidos · benchmark ${num(p, "benchmarkCents")}c`,

  gen_started: (p) =>
    `🌱 Geração ${num(p, "genNumber")} (${str(p, "cohort")}) começou — ${str(p, "seedNote")}`,

  gen_ended: (p) =>
    `⚰️ Geração ${num(p, "genNumber")} (${str(p, "cohort")}) acabou · pico ${usd(p, "peakEquityMc")} · ${num(p, "daysLived")} dias${p.isNewRecord ? " · 🔔 NOVO RECORDE" : ""}`,

  record_broken: (p) =>
    `🔔 RECORDE: ${usd(p, "peakEquityMc")} (${str(p, "cohort")}, gen ${num(p, "genNumber")}) — anterior ${usd(p, "previousRecordMc")}`,

  catch_up: (p) => `⏪ catch-up de ${num(p, "bars")} barras`,
};

export function formatEventPt(type: string, payload: Record<string, unknown>): string {
  const formatter = FORMATTERS[type];
  if (!formatter) return escapeHtml(type);
  return formatter(payload);
}
