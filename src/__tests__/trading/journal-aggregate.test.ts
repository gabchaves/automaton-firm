import { describe, it, expect } from "vitest";
import { aggregateJournals } from "../../trading/journal-aggregate.js";
import type { JournalEntry } from "../../trading/journal.js";

describe("aggregateJournals", () => {
  it("summarizes trade outcomes and aggregates mistakes", () => {
    const entries: JournalEntry[] = [
      {
        traderId: "t1",
        generation: 0,
        symbol: "BTCUSDT",
        side: "sell",
        entryCents: 5000000,
        exitCents: 5200000,
        sizeQty: 0.001,
        pnlCents: 200,
        thesis: "Breakout confirmed",
        mistake: "None",
      },
      {
        traderId: "t1",
        generation: 0,
        symbol: "BTCUSDT",
        side: "sell",
        entryCents: 5200000,
        exitCents: 5000000,
        sizeQty: 0.001,
        pnlCents: -200,
        thesis: "Chased top",
        mistake: "Entered after 3% extension",
      },
      {
        traderId: "t2",
        generation: 0,
        symbol: "BTCUSDT",
        side: "sell",
        entryCents: 5100000,
        exitCents: 4900000,
        sizeQty: 0.001,
        pnlCents: -200,
        thesis: "FOMO buy",
        mistake: "Entered after 3% extension",
      },
    ];

    const summary = aggregateJournals(entries);
    expect(summary.totalTrades).toBe(3);
    expect(summary.winCount).toBe(1);
    expect(summary.lossCount).toBe(2);
    expect(summary.totalPnlCents).toBe(-200);
    expect(summary.mistakes).toEqual([{ mistake: "Entered after 3% extension", count: 2 }]);
    expect(summary.theses.length).toBe(3);
  });
});
