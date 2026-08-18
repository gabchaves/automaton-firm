import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MuralTab } from "../tabs/MuralTab";
import { fixtureSnapshot } from "./fixtures";

describe("MuralTab", () => {
  it("shows a placeholder when there is no snapshot yet", () => {
    render(<MuralTab snapshot={null} />);
    expect(screen.getByText("Sem eventos ainda.")).toBeInTheDocument();
  });

  it("shows the reactions disclaimer once at the top of the list", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText(/reações são decorativas/i)).toBeInTheDocument();
  });

  it("builds a headline post from the trade_closed payload for a big win", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText("📈 Lucro em destaque")).toBeInTheDocument();
    expect(screen.getByText(/Fechamos BTCUSDT com lucro de \$0\.60/)).toBeInTheDocument();
  });

  it("renders a trader_fired post authored by RH with the quoted reason", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText("📦 Desligamento")).toBeInTheDocument();
    expect(screen.getByText(/encerramos o ciclo de Caue Reis/)).toBeInTheDocument();
    expect(screen.getByText("underperformance sustentada")).toBeInTheDocument();
    // RH is the post's author, not the fired employee.
    expect(screen.getAllByText("RH").length).toBeGreaterThan(0);
  });

  it("collapses consecutive small same-symbol trades into one grouped post", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    // Fixture has one trade_closed ($0.02) + one trade_opened on ETHUSDT,
    // consecutive in feed order — both below the $0.05 grouping threshold.
    expect(screen.getByText("🔁 Resumo da mesa")).toBeInTheDocument();
    expect(screen.getByText(/mesa de ETHUSDT girou 2 trades pequenos/)).toBeInTheDocument();
  });

  it("falls back to the pre-escaped html for an event type it doesn't model as a post", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    // "catch_up" has no headline mapping in mural-posts.ts.
    expect(screen.getByText("⏪ catch-up de 12 barras")).toBeInTheDocument();
  });

  it("renders deterministic, seeded reaction counts across two separate renders", () => {
    const { unmount } = render(<MuralTab snapshot={fixtureSnapshot} />);
    const firstRun = screen.getByText("📈 Lucro em destaque").closest("li")?.textContent;
    unmount();
    cleanup();

    render(<MuralTab snapshot={fixtureSnapshot} />);
    const secondRun = screen.getByText("📈 Lucro em destaque").closest("li")?.textContent;

    expect(firstRun).toBeTruthy();
    expect(firstRun).toBe(secondRun);
  });

  it("only shows the 😢 reaction on fired/died posts", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    const firedPost = screen.getByText("📦 Desligamento").closest("li");
    const hiredPost = screen.getByText("🤝 Nova contratação").closest("li");

    expect(firedPost?.textContent).toContain("😢");
    expect(hiredPost?.textContent).not.toContain("😢");
  });
});
