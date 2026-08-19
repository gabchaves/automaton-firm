import { describe, expect, it } from "vitest";
import { orderLeaderboardRows, isDividerRow, type LeaderboardEntry } from "../leaderboard-order";

function entry(overrides: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, "traderId" | "name" | "cohort" | "status" | "bookMc">): LeaderboardEntry {
  return {
    genNumber: 1,
    realizedPnlMc: 0,
    tradesCount: 0,
    symbol: "BTCUSDT",
    leverage: 2,
    genes: "momentum",
    combinator: "any",
    genome: { symbol: "BTCUSDT", leverage: 2, riskFraction: 0.5, combinator: "any", minHoldBars: 0, genes: [] },
    achievements: [],
    inPosition: false,
    entryPriceCents: null,
    ...overrides,
  };
}

describe("orderLeaderboardRows", () => {
  it("sorts a fired employee with a HIGHER book below a live employee with a lower book, in the same cohort", () => {
    // Without the explicit client-side re-sort, a naive book-desc sort
    // would put "High Book Fired" first — this is the regression case.
    const entries = [
      entry({ traderId: "t-fired", name: "High Book Fired", cohort: "evolved", status: "fired", bookMc: 999_000 }),
      entry({ traderId: "t-live", name: "Low Book Live", cohort: "evolved", status: "live", bookMc: 100_000 }),
    ];

    const rows = orderLeaderboardRows(entries).filter((row) => !isDividerRow(row));
    expect(rows.map((row) => (row as LeaderboardEntry).name)).toEqual(["Low Book Live", "High Book Fired"]);
  });

  it("orders live < fired < dead within a cohort, book desc within each tier", () => {
    const entries = [
      entry({ traderId: "d1", name: "Dead Big", cohort: "evolved", status: "dead", bookMc: 0 }),
      entry({ traderId: "f1", name: "Fired Big", cohort: "evolved", status: "fired", bookMc: 500_000 }),
      entry({ traderId: "l1", name: "Live Small", cohort: "evolved", status: "live", bookMc: 50_000 }),
      entry({ traderId: "l2", name: "Live Big", cohort: "evolved", status: "live", bookMc: 400_000 }),
      entry({ traderId: "f2", name: "Fired Small", cohort: "evolved", status: "fired", bookMc: 10_000 }),
    ];

    const rows = orderLeaderboardRows(entries).filter((row) => !isDividerRow(row)) as LeaderboardEntry[];
    expect(rows.map((row) => row.name)).toEqual(["Live Big", "Live Small", "Fired Big", "Fired Small", "Dead Big"]);
  });

  it("assigns rank numbers (1, 2, 3...) only to live rows, skipping fired/dead entirely", () => {
    const entries = [
      entry({ traderId: "l1", name: "Live A", cohort: "evolved", status: "live", bookMc: 200_000 }),
      entry({ traderId: "f1", name: "Fired A", cohort: "evolved", status: "fired", bookMc: 900_000 }),
      entry({ traderId: "l2", name: "Live B", cohort: "evolved", status: "live", bookMc: 100_000 }),
    ];

    const rows = orderLeaderboardRows(entries).filter((row) => !isDividerRow(row));
    const ranks = rows.map((row) => ("rank" in row ? row.rank : undefined));
    expect(ranks).toEqual([1, 2, null]); // Live A, Live B, Fired A (no rank)
  });

  it("inserts a single divider marker right before the first non-live row of a cohort, only when one exists", () => {
    const withNonLive = [
      entry({ traderId: "l1", name: "Live A", cohort: "evolved", status: "live", bookMc: 200_000 }),
      entry({ traderId: "f1", name: "Fired A", cohort: "evolved", status: "fired", bookMc: 900_000 }),
      entry({ traderId: "d1", name: "Dead A", cohort: "evolved", status: "dead", bookMc: 0 }),
    ];
    const rows = orderLeaderboardRows(withNonLive);
    const dividerIndices = rows.map((row, i) => (isDividerRow(row) ? i : -1)).filter((i) => i !== -1);
    expect(dividerIndices).toEqual([1]); // exactly one, right before "Fired A"

    const allLive = [
      entry({ traderId: "l1", name: "Live A", cohort: "evolved", status: "live", bookMc: 200_000 }),
      entry({ traderId: "l2", name: "Live B", cohort: "evolved", status: "live", bookMc: 100_000 }),
    ];
    expect(orderLeaderboardRows(allLive).some(isDividerRow)).toBe(false);
  });

  it("keeps cohorts in their order of first appearance, each with its own divider", () => {
    const entries = [
      entry({ traderId: "e-live", name: "Evolved Live", cohort: "evolved", status: "live", bookMc: 300_000 }),
      entry({ traderId: "e-fired", name: "Evolved Fired", cohort: "evolved", status: "fired", bookMc: 500_000 }),
      entry({ traderId: "r-live", name: "Random Live", cohort: "random", status: "live", bookMc: 200_000 }),
      entry({ traderId: "r-dead", name: "Random Dead", cohort: "random", status: "dead", bookMc: 0 }),
    ];

    const rows = orderLeaderboardRows(entries);
    const names = rows.map((row) => (isDividerRow(row) ? `divider(${row.cohort})` : (row as LeaderboardEntry).name));
    expect(names).toEqual([
      "Evolved Live", "divider(evolved)", "Evolved Fired",
      "Random Live", "divider(random)", "Random Dead",
    ]);
  });
});
