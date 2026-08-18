import { describe, expect, it } from "vitest";
import { moodEmoji } from "../mood";

// STAKE_MC mirrors TRADER_START_MC (2_000_000 mc, $20.00). Thresholds are
// ratios of bookMc / STAKE_MC per the v3 plan's fun-pass addendum.
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
    expect(moodEmoji("live", 2_100_000)).toBe("😎");
    expect(moodEmoji("live", 3_000_000)).toBe("😎");
  });

  it("returns the smile in the normal 100-105% band", () => {
    expect(moodEmoji("live", 2_000_000)).toBe("🙂"); // exactly 100%
    expect(moodEmoji("live", 2_099_999)).toBe("🙂"); // just under 105%
  });

  it("returns the grimace in the uneasy 95-100% band", () => {
    expect(moodEmoji("live", 1_900_000)).toBe("😬"); // exactly 95%
    expect(moodEmoji("live", 1_999_999)).toBe("😬"); // just under 100%
  });

  it("returns the cold sweat below 95% of stake", () => {
    expect(moodEmoji("live", 1_899_999)).toBe("😰");
    expect(moodEmoji("live", 0)).toBe("😰");
  });
});
