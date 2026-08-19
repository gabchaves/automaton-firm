import { describe, expect, it } from "vitest";
import { buildMuralPosts } from "../tabs/mural-posts";
import type { PalcoSnapshot } from "../types";

type FeedItem = PalcoSnapshot["feed"][number];

function tradeClosed(id: number, symbol: string, realizedPnlMc: number): FeedItem {
  return {
    id,
    ts: 1_700_000_000_000 + id,
    type: "trade_closed",
    html: "",
    payload: { symbol, realizedPnlMc, feeMc: 10, liquidated: false },
  };
}

/**
 * v4 Task B2: SMALL_TRADE_THRESHOLD_MC (mural-posts.ts's internal
 * `smallTradeThresholdMc`) must be derived from `genStartMc` — 2% of it,
 * never a hardcoded dollar figure — so a custom fixture with an unusual
 * bankroll scale still gets the right individual-post/grouped-resumo split.
 * A CUSTOM genStartMc here (not the Motor's real 100_000_000, not this
 * package's other fixtures' 1_000_000) is deliberate: it proves the
 * derivation, not a coincidence at one particular scale.
 */
describe("buildMuralPosts — small-trade threshold derivation (v4 Task B2)", () => {
  const CUSTOM_GEN_START_MC = 5_000_000; // 2% -> 100_000 mc = $1.00 threshold

  it("folds a trade right at 1% of genStartMc (below the 2% threshold) into the grouped resumo", () => {
    const onePercentMc = CUSTOM_GEN_START_MC / 100; // $0.50 — under the $1.00 threshold
    const posts = buildMuralPosts([tradeClosed(1, "BTCUSDT", onePercentMc)], CUSTOM_GEN_START_MC);

    expect(posts).toHaveLength(1);
    expect(posts[0].headline).toBe("🔁 Resumo da mesa BTCUSDT");
  });

  it("keeps a trade above 2% of genStartMc as its own individual spotlight post", () => {
    const threePercentMc = (CUSTOM_GEN_START_MC * 3) / 100; // $1.50 — clears the $1.00 threshold
    const posts = buildMuralPosts([tradeClosed(2, "BTCUSDT", threePercentMc)], CUSTOM_GEN_START_MC);

    expect(posts).toHaveLength(1);
    expect(posts[0].headline).toBe("📈 Lucro em destaque");
  });

  it("scales the split point with genStartMc: the SAME pnl folds into a resumo at one scale but stays individual at another", () => {
    const pnlMc = 150_000; // $1.50 fixed

    // At genStartMc = 1_000_000 (this package's other fixtures' scale), 2%
    // is $0.20 — $1.50 clears it easily.
    const atSmallScale = buildMuralPosts([tradeClosed(3, "ETHUSDT", pnlMc)], 1_000_000);
    expect(atSmallScale[0].headline).toBe("📈 Lucro em destaque");

    // At a genStartMc where 2% is bigger than $1.50 (e.g. 10_000_000 -> 2%
    // = $2.00), the exact same $1.50 pnl instead folds into the resumo —
    // proving the threshold moves with the fixture, not a fixed dollar figure.
    const atLargeScale = buildMuralPosts([tradeClosed(4, "ETHUSDT", pnlMc)], 10_000_000);
    expect(atLargeScale[0].headline).toBe("🔁 Resumo da mesa ETHUSDT");
  });
});
