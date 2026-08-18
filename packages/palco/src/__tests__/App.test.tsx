import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../App";
import { fixtureSnapshot } from "./fixtures";

// jsdom has no real <canvas> 2D context or layout engine, which chart.js's
// responsive-resize plumbing depends on; it throws when mounted under
// jsdom. These smoke tests only assert on the masthead/tabs/footer, not
// chart rendering, so the chart components are stubbed out here.
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

  it("renders the masthead and all four tab headers", async () => {
    render(<App />);

    expect(await screen.findByText("A Firma")).toBeInTheDocument();
    expect(screen.getByText(/Automaton · pesquisa de trading/i)).toBeInTheDocument();

    for (const tabName of ["Pregão", "Gerações", "Leaderboard", "Mural"]) {
      expect(screen.getByText(tabName)).toBeInTheDocument();
    }
  });

  it("shows the honesty footer verbatim", async () => {
    render(<App />);

    expect(await screen.findByText("A Firma")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Dinheiro real só entra em discussão se a linhagem evoluída vencer o controle aleatório E o não-fazer-nada por ≥ 3 meses de dados virgens ao vivo, fora da banda de ruído\./,
      ),
    ).toBeInTheDocument();
  });
});
