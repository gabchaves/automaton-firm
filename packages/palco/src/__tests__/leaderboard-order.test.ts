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
    const entries = [
      entry({ traderId: "t-fired", name: "High Book Fired", cohort: "evolved", status: "fired", bookMc: 999_000 }),
      entry({ traderId: "t-live", name: "Low Book Live", cohort: "evolved", status: "live", bookMc: 100_000 }),
    ];

    const rows = orderLeaderboardRows(entries).filter((row) => !isDividerRow(row));
    expect(rows.map((row) => (row as LeaderboardEntry).name)).toEqual(["Low Book Live", "High Book Fired"]);
  });

  it("v4.1 regression: a fired seat from cohort A never outranks a LIVE seat from cohort B — closed seats sit at the true end of the whole table, not just the end of their own cohort's block", () => {
    const entries = [
      entry({ traderId: "e-live", name: "Evolved Live", cohort: "evolved", status: "live", bookMc: 300_000 }),
      entry({ traderId: "e-fired", name: "Evolved Fired", cohort: "evolved", status: "fired", bookMc: 900_000 }),
      entry({ traderId: "r-live", name: "Random Live", cohort: "random", status: "live", bookMc: 50_000 }),
    ];

    const rows = orderLeaderboardRows(entries).filter((row) => !isDividerRow(row)) as LeaderboardEntry[];
    // Both live rows (any cohort) come before the fired one, regardless of book size.
    expect(rows.map((row) => row.name)).toEqual(["Evolved Live", "Random Live", "Evolved Fired"]);
  });

  it("groups live rows by cohort (team-grouped display), then ALL closed seats from every cohort together at the bottom: live < fired < dead, book desc within each tier", () => {
    const entries = [
      // Cohort grouping order follows first appearance in the raw array —
      // "evolved" leads here because "Evolved Fired Big" is entries[0], even
      // though it's a closed seat (closed rows don't influence live-block
      // ordering, but which cohort each live block belongs to is still keyed
      // off first appearance across the whole array).
      entry({ traderId: "f1", name: "Evolved Fired Big", cohort: "evolved", status: "fired", bookMc: 500_000 }),
      entry({ traderId: "d1", name: "Random Dead", cohort: "random", status: "dead", bookMc: 0 }),
      entry({ traderId: "l1", name: "Evolved Live Small", cohort: "evolved", status: "live", bookMc: 50_000 }),
      entry({ traderId: "l2", name: "Evolved Live Big", cohort: "evolved", status: "live", bookMc: 400_000 }),
      entry({ traderId: "l3", name: "Random Live", cohort: "random", status: "live", bookMc: 10_000 }),
      entry({ traderId: "f2", name: "Random Fired Small", cohort: "random", status: "fired", bookMc: 10_000 }),
    ];

    const rows = orderLeaderboardRows(entries).filter((row) => !isDividerRow(row)) as LeaderboardEntry[];
    expect(rows.map((row) => row.name)).toEqual([
      "Evolved Live Big", "Evolved Live Small", // evolved live block
      "Random Live",                            // random live block
      "Evolved Fired Big", "Random Fired Small", "Random Dead", // closed seats, both cohorts, live<fired<dead, book desc within tier
    ]);
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

  it("inserts exactly one divider marker, right before the closed-seats block, only when a non-live row exists anywhere", () => {
    const withNonLive = [
      entry({ traderId: "l1", name: "Live A", cohort: "evolved", status: "live", bookMc: 200_000 }),
      entry({ traderId: "l2", name: "Live B", cohort: "random", status: "live", bookMc: 150_000 }),
      entry({ traderId: "f1", name: "Fired A", cohort: "evolved", status: "fired", bookMc: 900_000 }),
      entry({ traderId: "d1", name: "Dead A", cohort: "random", status: "dead", bookMc: 0 }),
    ];
    const rows = orderLeaderboardRows(withNonLive);
    const dividerIndices = rows.map((row, i) => (isDividerRow(row) ? i : -1)).filter((i) => i !== -1);
    expect(dividerIndices).toEqual([2]); // right after both live rows, before the closed block

    const allLive = [
      entry({ traderId: "l1", name: "Live A", cohort: "evolved", status: "live", bookMc: 200_000 }),
      entry({ traderId: "l2", name: "Live B", cohort: "evolved", status: "live", bookMc: 100_000 }),
    ];
    expect(orderLeaderboardRows(allLive).some(isDividerRow)).toBe(false);
  });

  it("keeps live rows grouped by cohort in order of first appearance", () => {
    const entries = [
      entry({ traderId: "e-live", name: "Evolved Live", cohort: "evolved", status: "live", bookMc: 300_000 }),
      entry({ traderId: "r-live", name: "Random Live", cohort: "random", status: "live", bookMc: 200_000 }),
    ];

    const rows = orderLeaderboardRows(entries) as LeaderboardEntry[];
    expect(rows.map((row) => row.name)).toEqual(["Evolved Live", "Random Live"]);
  });
});
