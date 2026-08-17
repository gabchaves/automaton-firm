import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../../state/database.js";
import { runCarryFirm } from "../../trading/carry-firm.js";
import type { CarryBar } from "../../trading/carry-types.js";

const bars = (n: number, rate: number): CarryBar[] =>
  Array.from({ length: n }, (_, i) => ({ time: i * 8 * 3600 * 1000, spotCents: 5_000_000, markCents: 5_000_000, fundingRate: rate }));

describe("runCarryFirm", () => {
  it("seeds and maintains the senior floor of 3", () => {
    const db = createDatabase(":memory:");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carry-firm-"));
    const res = runCarryFirm({ db, bars: bars(50, 0.0), seniorStartCents: 100_000, homeDir: home });
    const liveSeniors = res.traders.filter((t) => t.role === "senior" && t.status === "live");
    expect(liveSeniors.length).toBe(3);
    db.close();
  });

  it("hires an intern when a senior crosses the profit threshold", () => {
    const db = createDatabase(":memory:");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carry-firm-"));
    // 10 bps funding for 300 bars -> seniors accrue ~50c/bar, cross $10 fast.
    const res = runCarryFirm({ db, bars: bars(300, 0.0010), seniorStartCents: 100_000, homeDir: home });
    const interns = res.traders.filter((t) => t.role === "intern");
    expect(interns.length).toBeGreaterThanOrEqual(1);
    expect(interns[0].parentId).toBeTruthy();
    expect(interns[0].bookBalanceCents).toBeGreaterThan(0); // staked from the parent
    // best trader is profitable, and per-trader stats were recorded
    expect(Math.max(...res.traders.map((t) => t.realizedPnlCents))).toBeGreaterThan(1000);
    const someStat = res.stats[res.traders[0].id];
    expect(someStat).toBeTruthy();
    expect(typeof someStat.cycles).toBe("number");
    db.close();
  });

  it("liquidates position and triggers death when adverse basis wipes out book", () => {
    const db = createDatabase(":memory:");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carry-firm-"));
    // Bar 0: enters at basis 0.
    // Bar 1+: mark price explodes 5x above spot, causing huge basis loss wiping out small 2000c ($20) book.
    const spikeBars: CarryBar[] = [
      { time: 0, spotCents: 5_000_000, markCents: 5_000_000, fundingRate: 0.0010 },
      { time: 8 * 3600 * 1000, spotCents: 5_000_000, markCents: 30_000_000, fundingRate: 0.0010 },
      { time: 16 * 3600 * 1000, spotCents: 5_000_000, markCents: 30_000_000, fundingRate: 0.0010 },
    ];
    const res = runCarryFirm({ db, bars: spikeBars, seniorStartCents: 2000, homeDir: home });
    expect(res.traders.some((t) => t.status === "dead")).toBe(true);
    const liveSeniors = res.traders.filter((t) => t.role === "senior" && t.status === "live");
    expect(liveSeniors.length).toBe(3); // backfilled
    db.close();
  });

  it("writes a per-trader stats sidecar", () => {
    const db = createDatabase(":memory:");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carry-firm-"));
    runCarryFirm({ db, bars: bars(100, 0.0010), seniorStartCents: 100_000, homeDir: home });
    const sidecar = path.join(home, ".automaton", "carry-firm-stats.json");
    expect(fs.existsSync(sidecar)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(sidecar, "utf-8"));
    expect(Object.keys(parsed).length).toBeGreaterThanOrEqual(3);
    db.close();
  });
});
