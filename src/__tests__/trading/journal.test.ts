import { describe, it, expect } from "vitest";
import { renderJournal } from "../../trading/journal.js";

describe("journal", () => {
  it("renders YAML frontmatter + thesis body", () => {
    const md = renderJournal(
      {
        traderId: "t1",
        generation: 0,
        symbol: "BTCUSDT",
        side: "buy",
        entryCents: 5_000_000,
        exitCents: 6_000_000,
        sizeQty: 0.001,
        pnlCents: 1000,
        thesis: "breakout",
        mistake: "sized too small",
      },
      "2026-08-16T00:00:00Z",
    );
    expect(md).toMatch(/^---\n/);
    expect(md).toMatch(/symbol: BTCUSDT/);
    expect(md).toMatch(/pnl_cents: 1000/);
    expect(md).toMatch(/breakout/);
  });
});
