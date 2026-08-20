import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../App";
import { fixtureSnapshot } from "./fixtures";

// jsdom has no real <canvas> 2D context or layout engine, which chart.js's
// responsive-resize plumbing depends on; it throws when mounted under
// jsdom. These smoke tests only assert on the shell/nav/footer, not chart
// rendering, so the chart components are stubbed out here.
vi.mock("react-chartjs-2", () => ({
  Line: () => <div data-testid="line-chart-stub" />,
  Chart: () => <div data-testid="chart-stub" />,
}));

class StubEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  close() {}
  constructor(public url: string) {}
}

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", StubEventSource as unknown as typeof EventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => Promise.resolve(fixtureSnapshot) }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the wordmark, kicker, and the 6-link site nav", async () => {
    render(<App />);

    expect(await screen.findByText("A Firma")).toBeInTheDocument();
    expect(screen.getByText(/Automaton · pesquisa de trading/i)).toBeInTheDocument();

    for (const label of ["Pregão", "Leaderboard", "Empresa", "Gerações", "Mural", "Sobre"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("switches to the LMArena-style Leaderboard route and renders traders from the snapshot", async () => {
    render(<App />);

    expect(await screen.findByTestId("line-chart-stub")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Leaderboard" }));

    // "Ada Faria" now renders twice — once in the top-3 podium strip, once
    // in the DataTable row (see LeaderboardTab.test.tsx for the detailed
    // per-column assertions) — so this smoke test just confirms it's there.
    expect(screen.getAllByText("Ada Faria").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Leaderboard" })).toHaveAttribute("aria-current", "page");
  });

  it("defaults to the Pregão route and switches content when a nav link is clicked", async () => {
    render(<App />);

    expect(await screen.findByTestId("line-chart-stub")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mural" }));

    expect(screen.getByText(/reações são decorativas/i)).toBeInTheDocument();
    expect(screen.queryByTestId("line-chart-stub")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mural" })).toHaveAttribute("aria-current", "page");
  });

  it("switches to the Sobre route and renders the builder + project copy", async () => {
    render(<App />);

    expect(await screen.findByTestId("line-chart-stub")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sobre" }));

    expect(screen.getByText("Gabriel Ernesto Chaves")).toBeInTheDocument();
    expect(screen.queryByTestId("line-chart-stub")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sobre" })).toHaveAttribute("aria-current", "page");
  });

  it("does NOT render the global honesty footer (it moved to the Sobre tab)", async () => {
    render(<App />);

    expect(await screen.findByText("A Firma")).toBeInTheDocument();
    expect(screen.queryByText(/Dinheiro real só entra em discussão/)).toBeNull();
  });

  it("renders the 'visão geral' hero cards only on the Pregão tab (v4.4 — moved out of the global header)", async () => {
    render(<App />);

    // Pregão is the default route — the relocated hero strip is now
    // PregaoTab's own masthead, not App's.
    expect(await screen.findByText("Equity da firma")).toBeInTheDocument();
    expect(screen.getByText("Controle aleatório")).toBeInTheDocument();
    expect(screen.getByText("Recorde (pico)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Empresa" }));

    expect(screen.queryByText("Equity da firma")).not.toBeInTheDocument();
    expect(screen.queryByText("Recorde (pico)")).not.toBeInTheDocument();
    // Nav and the live dot stay global across every tab (TickerTape has its
    // own dedicated coverage in TickerTape.test.tsx).
    expect(screen.getByRole("button", { name: "Empresa" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(/ao vivo|reconectando…/)).toBeInTheDocument();
  });
});
