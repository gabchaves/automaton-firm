import { describe, it, expect } from "vitest";
import { renderJournal, parseJournalFile } from "../../trading/journal.js";

describe("parseJournalFile", () => {
  it("round-trips a rendered journal", () => {
    const entry = {
      traderId: "t1",
      generation: 2,
      symbol: "BTCUSDT",
      side: "buy" as const,
      entryCents: 6300000,
      exitCents: 6350000,
      sizeQty: 0.001,
      pnlCents: 50,
      thesis: "breakout held",
      mistake: "sized small",
    };
    const parsed = parseJournalFile(renderJournal(entry, "2026-08-17T00:00:00Z"));
    expect(parsed).not.toBeNull();
    expect(parsed!.traderId).toBe("t1");
    expect(parsed!.generation).toBe(2);
    expect(parsed!.symbol).toBe("BTCUSDT");
    expect(parsed!.side).toBe("buy");
    expect(parsed!.entryCents).toBe(6300000);
    expect(parsed!.exitCents).toBe(6350000);
    expect(parsed!.sizeQty).toBe(0.001);
    expect(parsed!.pnlCents).toBe(50);
    expect(parsed!.thesis).toContain("breakout");
    expect(parsed!.mistake).toContain("sized");
  });

  it("returns null when there is no frontmatter", () => {
    expect(parseJournalFile("just some text")).toBeNull();
  });
});
