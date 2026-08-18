/** Client-side money/date helpers. Mirrors the $X.XX convention used across
 * the Motor's dashboard and server (mc = milli-cents; /100_000 => dollars). */

export function usd(mc: number): string {
  return `$${(mc / 100_000).toFixed(2)}`;
}

/** Formats a raw price-in-cents field (e.g. `entryPriceCents`, matching the
 * Motor's `priceCents` payload convention) to a dollar string. Distinct
 * from `usd()`, which divides milli-cents — do not mix the two units. */
export function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function dateShort(ts: number): string {
  return new Date(ts).toISOString().slice(5, 16).replace("T", " ");
}

// Fixed formatters (not per-call `new Intl.DateTimeFormat(...)`) — cheaper
// to reuse, and `timeZone` is pinned to Brasília time rather than left to
// the runtime's local zone: without it, the same `ts` would render a
// different clock time on a UTC CI box than on a dev machine, which is
// exactly the kind of non-determinism this codebase avoids everywhere else
// (mirrors `relativeTime`'s "caller supplies now" rule below).
const ORKUT_DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});
const ORKUT_TIME_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Sao_Paulo",
});

/** Absolute Orkut-scrap timestamp — "em DD/MM/AAAA HH:MM", Brasília time.
 * Task 5 of the v3 plan calls for this exact classic-Orkut absolute
 * format (as opposed to `relativeTime`'s "há 3 min"); built from plain
 * `Intl.DateTimeFormat` per the plan's explicit "no new dep" ruling — no
 * date-fns. Date and time are formatted separately and joined with a
 * plain space so the output never depends on an ICU version's default
 * date+time join punctuation (some locales/versions insert a comma). */
export function absoluteTimestamp(ts: number): string {
  return `em ${ORKUT_DATE_FORMAT.format(ts)} ${ORKUT_TIME_FORMAT.format(ts)}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Relative time string for the Mural/Empresa feeds. Pure function of
 * (ts, nowMs) — no Date.now() inside, same pattern as the Motor's
 * buildSnapshot(raw, nowMs): the caller supplies "now" so this stays
 * testable and has one clear source of non-determinism. */
export function relativeTime(ts: number, nowMs: number): string {
  const diffMs = Math.max(0, nowMs - ts);
  if (diffMs < MINUTE_MS) return "agora mesmo";
  if (diffMs < HOUR_MS) return `há ${Math.floor(diffMs / MINUTE_MS)} min`;
  if (diffMs < DAY_MS) return `há ${Math.floor(diffMs / HOUR_MS)} h`;
  const days = Math.floor(diffMs / DAY_MS);
  if (days === 1) return "ontem";
  return `há ${days} d`;
}
