import { describe, expect, it } from "vitest";
import { moodEmoji, STAKE_MC } from "../mood";

// STAKE_MC mirrors TRADER_START_MC (20_000_000 mc, $200.00) and is only the
// FALLBACK used when a caller has no live snapshot yet. Thresholds are
// ratios of bookMc / stakeMc per the v3 plan's fun-pass addendum.
describe("moodEmoji", () => {
  it("returns the skull for a dead trader regardless of book", () => {
    expect(moodEmoji("dead", 5_000_000)).toBe("💀");
    expect(moodEmoji("dead", 0)).toBe("💀");
  });

  it("returns the box for a fired trader regardless of book", () => {
    expect(moodEmoji("fired", 5_000_000)).toBe("📦");
    expect(moodEmoji("fired", 0)).toBe("📦");
  });

  it("returns the sunglasses when book is at least 105% of stake", () => {
    expect(moodEmoji("live", 21_000_000)).toBe("😎");
    expect(moodEmoji("live", 30_000_000)).toBe("😎");
  });

  it("returns the smile in the normal 100-105% band", () => {
    expect(moodEmoji("live", 20_000_000)).toBe("🙂"); // exactly 100%
    expect(moodEmoji("live", 20_999_999)).toBe("🙂"); // just under 105%
  });

  it("returns the grimace in the uneasy 95-100% band", () => {
    expect(moodEmoji("live", 19_000_000)).toBe("😬"); // exactly 95%
    expect(moodEmoji("live", 19_999_999)).toBe("😬"); // just under 100%
  });

  it("returns the cold sweat below 95% of stake", () => {
    expect(moodEmoji("live", 18_999_999)).toBe("😰");
    expect(moodEmoji("live", 0)).toBe("😰");
  });

  it("accepts an explicit stakeMc override, so it works at any bankroll scale (not just the STAKE_MC fallback)", () => {
    // A much smaller stake (e.g. a fixture's traderStartMc: 200_000) still
    // applies the exact same ratio thresholds, just against its own scale.
    expect(moodEmoji("live", 210_000, 200_000)).toBe("😎"); // 105% of 200_000
    expect(moodEmoji("live", 200_000, 200_000)).toBe("🙂"); // exactly 100%
    expect(moodEmoji("live", 190_000, 200_000)).toBe("😬"); // exactly 95%
    expect(moodEmoji("live", 100_000, 200_000)).toBe("😰"); // 50%
  });

  it("defaults to STAKE_MC when no explicit stakeMc is passed", () => {
    expect(moodEmoji("live", 20_000_000)).toBe(moodEmoji("live", 20_000_000, STAKE_MC));
  });
});
