import type { PalcoSnapshot } from "../types";

/** Shared fixture PalcoSnapshot for RTL smoke tests across this package. */
export const fixtureSnapshot: PalcoSnapshot = {
  generatedAt: 1_700_000_000_000,
  lastEventId: 42,
  cards: {
    evolvedEquityMc: 1_234_500,
    randomEquityMc: 987_600,
    evolvedGen: 3,
    randomGen: 3,
    recordEvolvedMc: 1_480_000,
    recordRandomMc: 1_100_000,
    gensEvolved: 3,
    gensRandom: 3,
    barsProcessed: 5_000,
    lastBarTs: 1_700_000_000_000,
    virginDays: 12.3,
  },
  generations: [
    { cohort: "evolved", genNumber: 1, peakEquityMc: 1_200_000, barsLived: 800, ended: true },
    { cohort: "evolved", genNumber: 2, peakEquityMc: 1_480_000, barsLived: 900, ended: true },
    { cohort: "evolved", genNumber: 3, peakEquityMc: 1_300_000, barsLived: 400, ended: false },
    { cohort: "random", genNumber: 1, peakEquityMc: 1_050_000, barsLived: 800, ended: true },
    { cohort: "random", genNumber: 2, peakEquityMc: 1_100_000, barsLived: 900, ended: true },
    { cohort: "random", genNumber: 3, peakEquityMc: 990_000, barsLived: 400, ended: false },
  ],
  equitySeries: {
    evolved: [
      [1_699_990_000_000, 1_000_000],
      [1_699_995_000_000, 1_150_000],
      [1_700_000_000_000, 1_234_500],
    ],
    random: [
      [1_699_990_000_000, 1_000_000],
      [1_699_995_000_000, 1_020_000],
      [1_700_000_000_000, 987_600],
    ],
  },
  leaderboard: [
    {
      name: "Ada",
      cohort: "evolved",
      genNumber: 3,
      status: "live",
      bookMc: 700_000,
      realizedPnlMc: 120_000,
      tradesCount: 14,
      symbol: "BTCUSDT",
      leverage: 2,
      genes: "momentum + carry",
      combinator: "weighted",
      achievements: ["Primeira semana viva", "Dobrou o book"],
    },
    {
      name: "Rand-7",
      cohort: "random",
      genNumber: 3,
      status: "live",
      bookMc: 500_000,
      realizedPnlMc: -20_000,
      tradesCount: 9,
      symbol: "ETHUSDT",
      leverage: 2,
      genes: "random",
      combinator: "none",
      achievements: [],
    },
  ],
  feed: [
    {
      id: 42,
      ts: 1_700_000_000_000,
      type: "trade_closed",
      html: "fechou BTCUSDT · P&amp;L $1.20",
    },
    {
      id: 41,
      ts: 1_699_999_000_000,
      type: "trader_hired",
      html: "🤝 <strong>Ada</strong> contratado(a) · slot 1 · stake $10.00",
    },
  ],
};
