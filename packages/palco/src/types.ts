/**
 * Mirror of `src/motor/palco-data.ts`'s `PalcoSnapshot` — keep in sync.
 *
 * `packages/palco` is a standalone Vite/React workspace app with its own
 * tsconfig; a cross-package TS import into `src/motor/` is not wired, so
 * this interface is hand-mirrored from the Motor's data layer instead. Any
 * shape change to `PalcoSnapshot` there must be copied here too.
 */
export interface PalcoGeneStruct {
  family: string;
  params: Record<string, number>; // family key stripped out
}

export interface PalcoGenome {
  symbol: string;
  leverage: number;
  riskFraction: number;
  combinator: string;
  genes: PalcoGeneStruct[];
}

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
    traderId: string;
    name: string;
    cohort: string;
    genNumber: number;
    status: string;
    bookMc: number;
    realizedPnlMc: number;
    tradesCount: number;
    symbol: string;
    leverage: number;
    genes: string; // back-compat "family + family" string
    combinator: string;
    genome: PalcoGenome; // structured genome, parsed params per gene
    achievements: string[];
  }>; // labels, from achievement events
  feed: Array<{ id: number; ts: number; type: string; html: string; payload: Record<string, unknown> }>; // 40 newest, html pre-formatted+escaped
  org: {
    hrPolicy: string; // fixed PT string
    employees: Array<{
      traderId: string;
      name: string;
      cohort: string;
      slot: number;
      status: string;
      bookMc: number;
      symbol: string;
      leverage: number;
      bornAt: number;
      diedAt: number | null;
      parentTraderId: string | null; // from the trader's own trader_hired event
      parentName: string | null;
      seedNote: string; // the trader's GENERATION seed_note (shared by every employee in that generation)
    }>; // every trader (any status) of the CURRENT (unended) generations, both cohorts
    history: Array<{ id: number; ts: number; type: string; html: string; payload: Record<string, unknown> }>;
    // trader_hired / trader_fired / trader_promoted / gen_started / gen_ended events
    // belonging to a CURRENT (unended) generation, chronological
  };
}
