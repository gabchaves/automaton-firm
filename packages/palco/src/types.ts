/**
 * Mirror of `src/motor/palco-data.ts`'s `PalcoSnapshot` — keep in sync.
 *
 * `packages/palco` is a standalone Vite/React workspace app with its own
 * tsconfig; a cross-package TS import into `src/motor/` is not wired, so
 * this interface is hand-mirrored from the Motor's data layer instead. Any
 * shape change to `PalcoSnapshot` there must be copied here too.
 */
export interface PalcoSnapshot {
  generatedAt: number; // caller-provided nowMs (no Date.now in the source module)
  lastEventId: number;
  cards: {
    evolvedEquityMc: number;
    randomEquityMc: number;
    evolvedGen: number;
    randomGen: number;
    recordEvolvedMc: number; // max(ended peaks, live peak)
    recordRandomMc: number;
    gensEvolved: number;
    gensRandom: number;
    barsProcessed: number;
    lastBarTs: number | null;
    virginDays: number; // (lastBarTs - min(generations.started_at)) / 86_400_000, 1 decimal
  };
  generations: Array<{
    cohort: string;
    genNumber: number;
    peakEquityMc: number;
    barsLived: number;
    ended: boolean;
  }>; // records chart, both cohorts
  equitySeries: { evolved: [number, number][]; random: [number, number][] }; // [ts, mc], ~400 pts
  leaderboard: Array<{
    name: string;
    cohort: string;
    genNumber: number;
    status: string;
    bookMc: number;
    realizedPnlMc: number;
    tradesCount: number;
    symbol: string;
    leverage: number;
    genes: string;
    combinator: string;
    achievements: string[];
  }>; // labels, from achievement events
  feed: Array<{ id: number; ts: number; type: string; html: string }>; // 40 newest, html pre-formatted+escaped
}
