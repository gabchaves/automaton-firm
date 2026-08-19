import { describe, expect, it } from "vitest";
import { seededKarma, seededPick } from "../rng";

describe("seededKarma", () => {
  it("is deterministic: the same seed always yields the same karma", () => {
    expect(seededKarma(50)).toBe(seededKarma(50));
  });

  it("returns a small positive integer (1-999), never 0 or negative", () => {
    for (const seed of [0, 1, 42, 999, 1_234_567]) {
      const karma = seededKarma(seed);
      expect(Number.isInteger(karma)).toBe(true);
      expect(karma).toBeGreaterThanOrEqual(1);
      expect(karma).toBeLessThanOrEqual(999);
    }
  });

  it("varies across different seeds (not a constant)", () => {
    const values = new Set([seededKarma(1), seededKarma(2), seededKarma(3), seededKarma(4), seededKarma(5)]);
    expect(values.size).toBeGreaterThan(1);
  });
});

describe("seededPick", () => {
  it("is deterministic: the same seed always picks the same subset, in the same order", () => {
    const names = ["Ada Faria", "Beto Nunes", "Caue Reis", "Rand-7"];
    expect(seededPick(names, 3, 42)).toEqual(seededPick(names, 3, 42));
  });

  it("never mutates the input array", () => {
    const names = ["Ada Faria", "Beto Nunes", "Caue Reis", "Rand-7"];
    const original = [...names];
    seededPick(names, 2, 1);
    expect(names).toEqual(original);
  });

  it("returns at most `count` items, all drawn from the input, with no duplicates", () => {
    const names = ["Ada Faria", "Beto Nunes", "Caue Reis", "Rand-7"];
    const picked = seededPick(names, 3, 7);
    expect(picked.length).toBe(3);
    expect(new Set(picked).size).toBe(3);
    for (const name of picked) expect(names).toContain(name);
  });

  it("clamps to the input length when count exceeds it", () => {
    const names = ["Ada Faria", "Beto Nunes"];
    expect(seededPick(names, 5, 1)).toHaveLength(2);
  });

  it("returns an empty array for an empty input", () => {
    expect(seededPick([], 3, 1)).toEqual([]);
  });
});
