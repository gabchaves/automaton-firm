import type { PalcoSnapshot } from "../types";

/**
 * Shared fixture PalcoSnapshot for RTL smoke tests across this package.
 *
 * The `feed` array is ordered newest-first (id descending), matching the
 * real API. It's deliberately built to exercise MuralTab's post-building
 * rules (v3.2 "less frequent" pass, individual-trade threshold = 1% of
 * this fixture's genStartMc = $0.10): a big-win BTCUSDT trade well above
 * that threshold (its own spotlight post), a
 * trade_opened event (id 41 — dropped entirely from the Mural, stays only
 * in Pregão/the ticker), and TWO small ETHUSDT trade_closed events that are
 * NOT consecutive in feed order (id 42 near the top, id 39 at the bottom,
 * with unrelated events — including id 41's dropped trade_opened — sitting
 * between them) — they still collapse into ONE grouped "resumo da mesa
 * ETHUSDT" post, proving the grouping is per-symbol across the whole
 * render, not just consecutive runs. Also one of every other
 * headline-mapped event type, and one unmapped type (catch_up) to exercise
 * the last-resort html fallback.
 *
 * `org.employees`' seedNote values are deliberately varied per employee
 * (not all sharing one generation-level string, unlike the real Motor) so
 * this single fixture can exercise every EmpresaTab lineage-line branch
 * (mutação / contratação externa / geração evoluída / no lineage for the
 * control cohort) in one place — see EmpresaTab.test.tsx.
 */
export const fixtureSnapshot: PalcoSnapshot = {
  generatedAt: 1_700_000_600_000,
  lastEventId: 51,
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
    // Deliberately a smaller scale than the real Motor's 100_000_000 /
    // 20_000_000 — proves every derived baseline/threshold/percentage in
    // the front works at ANY scale, not just the current production one.
    genStartMc: 1_000_000,
    traderStartMc: 200_000,
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
      traderId: "t-ada",
      name: "Ada Faria",
      cohort: "evolved",
      genNumber: 3,
      status: "live",
      bookMc: 700_000,
      realizedPnlMc: 120_000,
      tradesCount: 14,
      symbol: "BTCUSDT",
      leverage: 2,
      genes: "momentum + breakout",
      combinator: "majority",
      genome: {
        symbol: "BTCUSDT",
        leverage: 2,
        riskFraction: 0.75,
        combinator: "majority",
        minHoldBars: 6,
        genes: [
          { family: "momentum", params: { fastBars: 8, slowBars: 34 } },
          { family: "breakout", params: { channelBars: 20 } },
        ],
      },
      achievements: ["Primeira semana viva", "Dobrou o book"],
      inPosition: true,
      entryPriceCents: 6_000_000,
    },
    {
      traderId: "t-rand7",
      name: "Rand-7",
      cohort: "random",
      genNumber: 3,
      status: "live",
      bookMc: 500_000,
      realizedPnlMc: -20_000,
      tradesCount: 9,
      symbol: "ETHUSDT",
      leverage: 2,
      genes: "meanReversion",
      combinator: "any",
      genome: {
        symbol: "ETHUSDT",
        leverage: 2,
        riskFraction: 0.6,
        combinator: "any",
        minHoldBars: 0,
        genes: [{ family: "meanReversion", params: { lookbackBars: 40, entryZ: 1.5 } }],
      },
      achievements: [],
      inPosition: false,
      entryPriceCents: null,
    },
  ],
  feed: [
    {
      id: 50,
      ts: 1_700_000_500_000,
      type: "trade_closed",
      html: "fechou BTCUSDT · P&amp;L $1.50",
      // $1.50 — above this fixture's $0.10 individual-post threshold (1% of
      // genStartMc), so this stays its own spotlight "big win" post instead
      // of folding into a grouped resumo.
      payload: { symbol: "BTCUSDT", priceCents: 6_000_000, realizedPnlMc: 150_000, feeMc: 100, liquidated: false },
    },
    {
      id: 49,
      ts: 1_700_000_400_000,
      type: "trader_fired",
      html: "📦 <strong>Caue Reis</strong> demitido(a) · devolveu $0.80<br><small>underperformance sustentada</small>",
      payload: { name: "Caue Reis", reason: "underperformance sustentada", returnedMc: 80_000 },
    },
    {
      id: 48,
      ts: 1_700_000_300_000,
      type: "trader_hired",
      html: "🤝 <strong>Beto Nunes</strong> contratado(a) · slot 1 · stake $2.00",
      payload: { name: "Beto Nunes", slot: 1, stakeMc: 200_000, parentTraderId: "t-ada" },
    },
    {
      id: 47,
      ts: 1_700_000_250_000,
      type: "achievement",
      html: '✨ <strong>Ada Faria</strong> — "Primeiro trade"',
      payload: { key: "first_trade", name: "Ada Faria", label: "Primeiro trade" },
    },
    {
      id: 46,
      ts: 1_700_000_200_000,
      type: "trader_died",
      html: "💀 <strong>Zeca Prado</strong> morreu · viveu 2.0h · pico $1.50",
      payload: { name: "Zeca Prado", slot: 4, ageMs: 7_200_000, bookPeakMc: 150_000 },
    },
    {
      id: 45,
      ts: 1_700_000_150_000,
      type: "record_broken",
      html: "🔔 RECORDE: $14.80 (evolved, gen 3) — anterior $14.00",
      payload: { cohort: "evolved", genNumber: 3, peakEquityMc: 1_480_000, previousRecordMc: 1_400_000 },
    },
    {
      id: 44,
      ts: 1_700_000_100_000,
      type: "gen_started",
      html: "🌱 Geração 3 (evolved) começou — 2 clones + 1 mutant",
      payload: { cohort: "evolved", genNumber: 3, seedNote: "2 clones + 1 mutant" },
    },
    {
      id: 43,
      ts: 1_700_000_050_000,
      type: "catch_up",
      html: "⏪ catch-up de 12 barras",
      payload: { fromTs: 1_699_999_000_000, toTs: 1_700_000_000_000, bars: 12 },
    },
    {
      id: 42,
      ts: 1_700_000_020_000,
      type: "trade_closed",
      html: "fechou ETHUSDT · P&amp;L $0.02",
      payload: { symbol: "ETHUSDT", priceCents: 300_000, realizedPnlMc: 2_000, feeMc: 10, liquidated: false },
    },
    {
      id: 41,
      ts: 1_700_000_010_000,
      type: "trade_opened",
      html: "abriu ETHUSDT · notional $5.00",
      payload: { symbol: "ETHUSDT", priceCents: 300_000, notionalMc: 500_000, feeMc: 50 },
    },
    {
      id: 40,
      ts: 1_700_000_000_000,
      type: "hr_review",
      html: "🧾 RH: 5 avaliados · 1 demitidos · 1 promovidos · 3 mantidos · benchmark 20c",
      payload: { reviewed: 5, fired: 1, promoted: 1, held: 3, benchmarkCents: 20 },
    },
    {
      id: 39,
      ts: 1_699_999_950_000,
      type: "trade_closed",
      html: "fechou ETHUSDT · P&amp;L $-0.01",
      // Small ETHUSDT loss, NOT adjacent to id 42's small ETHUSDT win (ids
      // 48-41 sit between them) — exercises whole-feed per-symbol grouping
      // rather than only-consecutive grouping.
      payload: { symbol: "ETHUSDT", priceCents: 295_000, realizedPnlMc: -1_000, feeMc: 10, liquidated: false },
    },
  ],
  org: {
    hrPolicy:
      "RH baseado em evidência: compara cada trader ao benchmark max(controle aleatório, não fazer nada) na mesma janela de 7 dias. Demite só com evidência clara de underperformance; evidência insuficiente nunca demite nem promove.",
    employees: [
      {
        traderId: "t-ada",
        name: "Ada Faria",
        cohort: "evolved",
        slot: 0,
        status: "live",
        bookMc: 700_000,
        symbol: "BTCUSDT",
        leverage: 2,
        bornAt: 1_699_000_000_000,
        diedAt: null,
        parentTraderId: null,
        parentName: null,
        seedNote: "fresh",
      },
      {
        traderId: "t-beto",
        name: "Beto Nunes",
        cohort: "evolved",
        slot: 1,
        status: "live",
        bookMc: 250_000,
        symbol: "ETHUSDT",
        leverage: 1,
        bornAt: 1_699_500_000_000,
        diedAt: null,
        parentTraderId: "t-ada",
        parentName: "Ada Faria",
        seedNote: "2 clones + 1 mutant",
      },
      {
        traderId: "t-caue",
        name: "Caue Reis",
        cohort: "evolved",
        slot: 2,
        status: "fired",
        bookMc: 0,
        symbol: "SOLUSDT",
        leverage: 3,
        bornAt: 1_698_000_000_000,
        diedAt: 1_699_800_000_000,
        parentTraderId: null,
        parentName: null,
        seedNote: "2 clones + 1 mutant",
      },
      {
        traderId: "t-rand7",
        name: "Rand-7",
        cohort: "random",
        slot: 0,
        status: "live",
        bookMc: 500_000,
        symbol: "ETHUSDT",
        leverage: 2,
        bornAt: 1_699_000_000_000,
        diedAt: null,
        parentTraderId: null,
        parentName: null,
        seedNote: "random-control",
      },
    ],
    history: [
      {
        id: 44,
        ts: 1_700_000_100_000,
        type: "gen_started",
        html: "🌱 Geração 3 (evolved) começou — 2 clones + 1 mutant",
        payload: { cohort: "evolved", genNumber: 3, seedNote: "2 clones + 1 mutant" },
      },
      {
        id: 48,
        ts: 1_700_000_300_000,
        type: "trader_hired",
        html: "🤝 <strong>Beto Nunes</strong> contratado(a) · slot 1 · stake $2.00",
        payload: { name: "Beto Nunes", slot: 1, stakeMc: 200_000, parentTraderId: "t-ada" },
      },
      {
        id: 49,
        ts: 1_700_000_400_000,
        type: "trader_fired",
        html: "📦 <strong>Caue Reis</strong> demitido(a) · devolveu $0.80<br><small>underperformance sustentada</small>",
        payload: { name: "Caue Reis", reason: "underperformance sustentada", returnedMc: 80_000 },
      },
      {
        id: 51,
        ts: 1_700_000_600_000,
        type: "trader_promoted",
        html: "🏆 <strong>Ada Faria</strong> promovido(a) — Trader do Ciclo",
        payload: { name: "Ada Faria", title: "Trader do Ciclo" },
      },
    ],
  },
};
