import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MuralTab } from "../tabs/MuralTab";
import { fixtureSnapshot } from "./fixtures";
import { absoluteTimestamp } from "../format";

describe("MuralTab", () => {
  it("shows a placeholder when there is no snapshot yet", () => {
    render(<MuralTab snapshot={null} />);
    expect(screen.getByText("Sem eventos ainda.")).toBeInTheDocument();
  });

  it("renders the scraps(N) tab header and the decorative breadcrumb", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    // 9 individually-mapped events + the ETHUSDT small-trade pair (id 42+41)
    // collapsed into one grouped "Resumo da mesa" post = 10 posts total.
    expect(screen.getByText("scraps (10)")).toBeInTheDocument();
    expect(screen.getByText("perfil")).toBeInTheDocument();
    expect(screen.getByText("scraps")).toBeInTheDocument();
    expect(screen.getByText("depoimentos")).toBeInTheDocument();
  });

  it("renders the fake visitor counter from lastEventId, zero-padded to 6 digits", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    // fixtureSnapshot.lastEventId === 51
    expect(screen.getByText("você é o visitante nº 000051")).toBeInTheDocument();
  });

  it("renders the fixed comunidades box with the three joke communities", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText("comunidades")).toBeInTheDocument();
    expect(screen.getByText("Eu amo taxa de funding (12 membros)")).toBeInTheDocument();
    expect(screen.getByText("Perdi tudo no 3x alavancado (5.021 membros)")).toBeInTheDocument();
    expect(screen.getByText("RH me demitiu por evidência (1 membro)")).toBeInTheDocument();
  });

  it("shows the reactions disclaimer as a panel footer", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText(/reações são decorativas/i)).toBeInTheDocument();
  });

  it("builds a headline post from the trade_closed payload for a big win", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText("📈 Lucro em destaque")).toBeInTheDocument();
    expect(screen.getByText(/Fechamos BTCUSDT com lucro de \$0\.60/)).toBeInTheDocument();
  });

  it("renders the scrap's author as a link-styled name plus cargo, and an absolute Orkut timestamp", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    // trade_closed(id 50)'s author is the symbol itself, per mural-posts.ts.
    const authorLink = screen.getByText("BTCUSDT", { selector: ".orkut-author-link" });
    expect(authorLink).toBeInTheDocument();
    expect(screen.getByText("Trader · Mesa BTCUSDT")).toBeInTheDocument();
    // Absolute "em DD/MM/AAAA HH:MM" format (Task 5) — computed the same
    // way the component does, not hardcoded, so this isn't timezone-fragile.
    expect(screen.getByText(absoluteTimestamp(1_700_000_500_000))).toBeInTheDocument();
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
    // Grouped into exactly one <li class="orkut-scrap">, not two.
    const resumoScraps = document.querySelectorAll("li.orkut-scrap");
    const matching = Array.from(resumoScraps).filter((li) => li.textContent?.includes("Resumo da mesa"));
    expect(matching).toHaveLength(1);
  });

  it("falls back to the pre-escaped html for an event type it doesn't model as a post", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    // "catch_up" has no headline mapping in mural-posts.ts.
    expect(screen.getByText("⏪ catch-up de 12 barras")).toBeInTheDocument();
  });

  it("renders the reactions footer as decorative Orkut-style phrases, deterministically across two separate renders", () => {
    const { unmount } = render(<MuralTab snapshot={fixtureSnapshot} />);
    const firstRun = screen.getByText("📈 Lucro em destaque").closest("li.orkut-scrap")?.textContent;
    expect(firstRun).toMatch(/pessoa(s)? aplaud(iu|iram)/);
    expect(firstRun).toContain("responder");
    unmount();
    cleanup();

    render(<MuralTab snapshot={fixtureSnapshot} />);
    const secondRun = screen.getByText("📈 Lucro em destaque").closest("li.orkut-scrap")?.textContent;

    expect(firstRun).toBeTruthy();
    expect(firstRun).toBe(secondRun);
  });

  it("only shows the 😢 reaction on fired/died posts", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    const firedPost = screen.getByText("📦 Desligamento").closest("li.orkut-scrap");
    const hiredPost = screen.getByText("🤝 Nova contratação").closest("li.orkut-scrap");

    expect(firedPost?.textContent).toContain("😢");
    expect(hiredPost?.textContent).not.toContain("😢");
  });
});
