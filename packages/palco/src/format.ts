/** Client-side money/date helpers. Mirrors the $X.XX convention used across
 * the Motor's dashboard and server (mc = milli-cents; /100_000 => dollars). */

export function usd(mc: number): string {
  return `$${(mc / 100_000).toFixed(2)}`;
}

export function dateShort(ts: number): string {
  return new Date(ts).toISOString().slice(5, 16).replace("T", " ");
}
