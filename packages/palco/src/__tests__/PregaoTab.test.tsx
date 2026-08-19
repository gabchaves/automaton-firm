import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PregaoTab } from "../tabs/PregaoTab";
import { usd } from "../format";
import { fixtureSnapshot } from "./fixtures";

// jsdom has no real <canvas> 2D context or layout engine, which chart.js's
// responsive-resize plumbing depends on; it throws when mounted under
// jsdom. These tests only assert on the positions/trades panels, not chart
// rendering, so the chart component is stubbed out here (same pattern as
// App.test.tsx).
vi.mock("react-chartjs-2", () => ({
  Line: () => <div data-testid="line-chart-stub" />,
}));

describe("PregaoTab", () => {
  it("renders the open positions panel with the inPosition fixture trader", () => {
    render(<PregaoTab snapshot={fixtureSnapshot} />);

    expect(screen.getByText("Posições abertas")).toBeInTheDocument();
    // Ada Faria is the fixture's only inPosition: true trader.
    expect(screen.getByText("Ada Faria")).toBeInTheDocument();
    expect(screen.getByText("BTCUSDT · 2x")).toBeInTheDocument();
    // entryPriceCents: 6_000_000 -> centsToUsd -> $60000.00
    expect(screen.getByText("$60000.00")).toBeInTheDocument();
    expect(screen.getByText("$7.00")).toBeInTheDocument(); // bookMc: 700_000
    expect(screen.getByText("LONG")).toBeInTheDocument();
  });

  it("does not list a trader who is not currently in a position", () => {
    render(<PregaoTab snapshot={fixtureSnapshot} />);

    // Rand-7 has inPosition: false in the fixture — it must not appear
    // inside the positions panel (it may still appear elsewhere on the
    // page, but not here).
    const panel = screen.getByText("Posições abertas").closest("section");
    expect(panel?.textContent).not.toContain("Rand-7");
  });

  it("shows the empty-state copy when nobody is in a position", () => {
    const noPositions = {
      ...fixtureSnapshot,
      leaderboard: fixtureSnapshot.leaderboard.map((trader) => ({
        ...trader,
        inPosition: false,
        entryPriceCents: null,
      })),
    };

    render(<PregaoTab snapshot={noPositions} />);

    expect(screen.getByText("ninguém posicionado — a firma espera sinal.")).toBeInTheDocument();
  });

  it("still renders the últimos trades list", () => {
    render(<PregaoTab snapshot={fixtureSnapshot} />);

    expect(screen.getByText("Últimos trades")).toBeInTheDocument();
    expect(screen.getByTestId("line-chart-stub")).toBeInTheDocument();
  });

  it("renders empty states without crashing when there is no snapshot yet", () => {
    render(<PregaoTab snapshot={null} />);

    expect(screen.getByText("ninguém posicionado — a firma espera sinal.")).toBeInTheDocument();
    expect(screen.getByText("Sem trades ainda.")).toBeInTheDocument();
  });

  it("renders windowed stat-cards per cohort (lucro 1h/24h, trades 24h, win rate 24h)", () => {
    render(<PregaoTab snapshot={fixtureSnapshot} />);

    expect(screen.getByText("Firma")).toBeInTheDocument();
    expect(screen.getByText("Controle")).toBeInTheDocument();
    expect(screen.getAllByText("Lucro 1h").length).toBe(2); // one per cohort group
    expect(screen.getAllByText("Lucro 24h").length).toBe(2);
    expect(screen.getAllByText("Trades 24h").length).toBe(2);
    expect(screen.getAllByText("Win rate 24h").length).toBe(2);

    // Firma (evolved): pnl1hMc 45_000 -> $0.45; pnl24hMc 120_000 -> $1.20;
    // trades24h 14; winRate24h 9/14 -> 64.3%.
    expect(screen.getByText("$0.45")).toBeInTheDocument();
    expect(screen.getByText("$1.20")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("64.3%")).toBeInTheDocument();

    // Controle (random): pnl1hMc -8_000 -> "-$0.08" formatted by usd().
    expect(screen.getByText(usd(-8_000))).toBeInTheDocument();
  });

  it("colors a negative windowed P&L card red via the pnl-neg override", () => {
    render(<PregaoTab snapshot={fixtureSnapshot} />);

    // Controle's pnl1hMc (-8_000) and pnl24hMc (-12_400) are both losses.
    const negValues = document.querySelectorAll(".hero-card .v.pnl-neg");
    expect(negValues.length).toBe(2);
  });

  it("renders the per-mesa 24h P&L table with BTC/ETH/SOL always present, even at zero", () => {
    render(<PregaoTab snapshot={fixtureSnapshot} />);

    expect(screen.getByText("P&L 24h por mesa")).toBeInTheDocument();
    expect(screen.getByText("BTCUSDT")).toBeInTheDocument();
    expect(screen.getByText("ETHUSDT")).toBeInTheDocument();
    // SOLUSDT has 0 trades in the fixture but must still be listed.
    expect(screen.getByText("SOLUSDT")).toBeInTheDocument();
    expect(screen.getByText(usd(0))).toBeInTheDocument();
  });

  it("still shows all three mesas at 0/0 when there is no snapshot yet", () => {
    render(<PregaoTab snapshot={null} />);

    expect(screen.getByText("BTCUSDT")).toBeInTheDocument();
    expect(screen.getByText("ETHUSDT")).toBeInTheDocument();
    expect(screen.getByText("SOLUSDT")).toBeInTheDocument();
  });
});
