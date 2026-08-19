import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TickerTape, buildTickerItems } from "../components/TickerTape";
import { fixtureSnapshot } from "./fixtures";

describe("buildTickerItems", () => {
  it("maps every trade_closed feed item to a ticker entry, dropping the USDT suffix", () => {
    const items = buildTickerItems(fixtureSnapshot.feed);
    const texts = items.map((item) => item.text);
    expect(texts).toContain("BTC ▲ +$0.60");
    expect(texts).toContain("ETH ▲ +$0.02");
  });

  it("ignores non-trade_closed feed items (trade_opened stays out of the tape)", () => {
    const items = buildTickerItems(fixtureSnapshot.feed);
    expect(items.some((item) => item.text.includes("notional"))).toBe(false);
  });
});

describe("TickerTape", () => {
  it("renders trade_closed items from the feed as scrolling ticker text", () => {
    render(<TickerTape feed={fixtureSnapshot.feed} />);

    expect(screen.getAllByText(/BTC ▲ \+\$0\.60/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ETH ▲ \+\$0\.02/).length).toBeGreaterThan(0);
  });

  it("colors a losing trade red", () => {
    const losingFeed = [
      { id: 1, ts: 0, type: "trade_closed", html: "", payload: { symbol: "SOLUSDT", realizedPnlMc: -50_000 } },
    ];
    render(<TickerTape feed={losingFeed} />);
    const [item] = screen.getAllByText(/SOL ▼ −\$0\.50/);
    expect(item.className).toContain("text-red");
  });

  it("falls back to the waiting message when there are no trade_closed items", () => {
    render(<TickerTape feed={[]} />);
    expect(screen.getByText("aguardando o pregão…")).toBeInTheDocument();
  });
});
