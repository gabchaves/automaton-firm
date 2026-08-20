import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

    // Ada Faria is the fixture's only inPosition: true trader, but she also
    // shows up in the "P&L por agente" table below (she traded in the last
    // 24h too) — scope every assertion to the positions panel itself.
    const panel = screen.getByText("Posições abertas").closest("section") as HTMLElement;
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByText("Ada Faria")).toBeInTheDocument();
    expect(within(panel).getByText("BTCUSDT · 2x")).toBeInTheDocument();
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

  it("renders the per-agent P&L table (v4.1 — replaces the per-mesa version) with 1h/24h columns", () => {
    render(<PregaoTab snapshot={fixtureSnapshot} />);

    // Ada Faria also appears in the positions panel (she's inPosition too) —
    // scope every assertion to the agent table itself.
    const table = screen.getByText("P&L por agente").closest("section") as HTMLElement;
    expect(table).toBeInTheDocument();
    // Fixture's byAgent24h: Ada Faria (1h $0.30, 24h $0.90), Nicolas Oliveira
    // (1h $0.15, 24h $0.30) — Ada's 1h value and Nicolas's 24h value are both
    // $0.30, so assert per-row instead of a bare value lookup.
    const adaRow = within(table).getByText("Ada Faria").closest("tr") as HTMLElement;
    expect(within(adaRow).getByText(usd(30_000))).toBeInTheDocument(); // 1h
    expect(within(adaRow).getByText(usd(90_000))).toBeInTheDocument(); // 24h

    const nicolasRow = within(table).getByText("Nicolas Oliveira").closest("tr") as HTMLElement;
    expect(within(nicolasRow).getByText(usd(15_000))).toBeInTheDocument(); // 1h
    expect(within(nicolasRow).getByText(usd(30_000))).toBeInTheDocument(); // 24h
  });

  it("shows the empty state when nobody has traded in the last 24h (or there is no snapshot yet)", () => {
    render(<PregaoTab snapshot={null} />);

    expect(screen.getByText("ninguém operou nas últimas 24h.")).toBeInTheDocument();
  });

  it("renders the relocated 'visão geral' hero cards (v4.4 — moved here from App.tsx's global header)", () => {
    render(<PregaoTab snapshot={fixtureSnapshot} />);

    expect(screen.getByText("Equity da firma")).toBeInTheDocument();
    expect(screen.getByText("Controle aleatório")).toBeInTheDocument();
    expect(screen.getByText("Não fazer nada")).toBeInTheDocument();
    expect(screen.getByText("Recorde (pico)")).toBeInTheDocument();
    expect(screen.getByText("Gerações vividas")).toBeInTheDocument();
    expect(screen.getByText("Dados virgens")).toBeInTheDocument();

    // evolvedEquityMc / randomEquityMc / genStartMc (the "não fazer nada"
    // baseline) / recordEvolvedMc — all formatted via the shared usd().
    expect(screen.getByText(usd(fixtureSnapshot.cards.evolvedEquityMc))).toBeInTheDocument();
    expect(screen.getByText(usd(fixtureSnapshot.cards.randomEquityMc))).toBeInTheDocument();
    expect(screen.getByText(usd(fixtureSnapshot.cards.genStartMc))).toBeInTheDocument();
    expect(screen.getByText(usd(fixtureSnapshot.cards.recordEvolvedMc))).toBeInTheDocument();
    // "controle: $11.00" — the NumberTicker renders its own <span>, so only
    // its own text node ("$11.00") is directly queryable; the "controle: "
    // prefix lives on a sibling text node inside the same .d div.
    expect(screen.getByText(usd(fixtureSnapshot.cards.recordRandomMc))).toBeInTheDocument();

    // evolvedGen and randomGen are both 3 in the fixture, so "Geração 3"
    // appears on both cards.
    expect(screen.getAllByText("Geração 3").length).toBe(2);
    // gensEvolved / gensRandom are both 3 too.
    expect(screen.getByText("firma / controle")).toBeInTheDocument();
    // virginDays 12.3 -> formatOneDecimal.
    expect(screen.getByText("12.3")).toBeInTheDocument();
    expect(screen.getByText("de 90 dias")).toBeInTheDocument();
  });

  it("lights up ShineBorder on 'Recorde (pico)' for a genuine new record above the generation's seed equity", () => {
    // Fixture's recordEvolvedMc (1_480_000) > genStartMc (1_000_000) — a
    // real record, not just the fresh-generation seed value.
    render(<PregaoTab snapshot={fixtureSnapshot} />);

    expect(screen.getByTestId("shine-border-overlay")).toBeInTheDocument();
  });

  it("keeps ShineBorder inactive when the record equals the generation's seed (no genuine record yet)", () => {
    const freshGen = {
      ...fixtureSnapshot,
      cards: { ...fixtureSnapshot.cards, recordEvolvedMc: fixtureSnapshot.cards.genStartMc },
    };

    render(<PregaoTab snapshot={freshGen} />);

    expect(screen.queryByTestId("shine-border-overlay")).not.toBeInTheDocument();
  });
});
