import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MuralTab } from "../tabs/MuralTab";
import { fixtureSnapshot } from "./fixtures";
import { absoluteTimestamp } from "../format";
import type { PalcoSnapshot } from "../types";

describe("MuralTab", () => {
  it("shows a placeholder when there is no snapshot yet", () => {
    render(<MuralTab snapshot={null} />);
    expect(screen.getByText("Sem eventos ainda.")).toBeInTheDocument();
  });

  it("renders the scraps(N) tab header and the decorative breadcrumb", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    // v3.2 "less frequent" pass: 9 individually-mapped events (the big-win
    // BTCUSDT trade, trader_fired, trader_hired, achievement, trader_died,
    // record_broken, gen_started, catch_up, hr_review-with-actions) + the
    // ETHUSDT small-trade group (ids 42 and 39, non-consecutive, collapsed
    // into one "resumo da mesa" post) = 10 posts total. id 41's
    // trade_opened is dropped entirely, not counted anywhere here.
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

  it("builds a headline post with a humanized body for a big win, from the trade_closed payload", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText("📈 Lucro em destaque")).toBeInTheDocument();
    // $1.50 (fixture id 50) is above this fixture's $0.10 individual-post
    // threshold (1% of cards.genStartMc = 1_000_000) — mulberry32(50)
    // deterministically picks this exact pool line.
    expect(
      screen.getByText("$1.50 no bolso. Não foi sorte — foi o genoma. (Foi um pouco de sorte.)"),
    ).toBeInTheDocument();
  });

  it("derives the small-trade threshold from cards.genStartMc: the fixture's $1.50 win clears its $0.10 threshold as an individual post, while the small ETHUSDT pair (well under it) still collapses into one grouped resumo", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);

    // Big win: its own spotlight post, never folded into a resumo group.
    expect(screen.getByText("📈 Lucro em destaque")).toBeInTheDocument();
    const bigWinScrap = screen.getByText("📈 Lucro em destaque").closest("li.orkut-scrap");
    expect(bigWinScrap?.textContent).not.toContain("Resumo da mesa");

    // Small trades (id 42: +$0.02, id 39: -$0.01 — both well under $0.10):
    // collapsed into exactly one grouped resumo post.
    expect(screen.getByText("🔁 Resumo da mesa ETHUSDT")).toBeInTheDocument();
    const resumoScraps = Array.from(document.querySelectorAll("li.orkut-scrap")).filter((li) =>
      li.textContent?.includes("Resumo da mesa"),
    );
    expect(resumoScraps).toHaveLength(1);
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

  it("renders a trader_fired post authored by RH, with a humanized body and the quoted reason", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText("📦 Desligamento")).toBeInTheDocument();
    // mulberry32(49) deterministically picks this exact pool line.
    expect(
      screen.getByText(
        "Comunicado do RH: encerramos o ciclo de Caue Reis. Devolveu $0.80 ao caixa. A decisão foi baseada em evidência — como sempre.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("underperformance sustentada")).toBeInTheDocument();
    // RH is the post's author, not the fired employee.
    expect(screen.getAllByText("RH").length).toBeGreaterThan(0);
  });

  it("collapses small same-symbol trades into one resumo post, even when they aren't consecutive in the feed", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    // Fixture has two small ETHUSDT trade_closed events (id 42: +$0.02, id
    // 39: -$0.01 — net +$0.01, count 2), separated by several unrelated
    // events (including id 41's dropped trade_opened). They still collapse
    // into exactly ONE "resumo da mesa ETHUSDT" post, per symbol per render.
    expect(screen.getByText("🔁 Resumo da mesa ETHUSDT")).toBeInTheDocument();
    expect(
      screen.getByText("2 operações miúdas, saldo $0.01. Formiguinha também é lucro."),
    ).toBeInTheDocument();
    const resumoScraps = document.querySelectorAll("li.orkut-scrap");
    const matching = Array.from(resumoScraps).filter((li) => li.textContent?.includes("Resumo da mesa"));
    expect(matching).toHaveLength(1);
  });

  it("never renders a post for trade_opened — it's dropped entirely from the Mural", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    // id 41 is a trade_opened ETHUSDT event; its own wording ("abriu",
    // "notional") must not appear anywhere in the Mural (it still shows up
    // in Pregão's trade feed and the ticker-tape, just not here).
    expect(screen.queryByText(/abriu ETHUSDT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/notional/)).not.toBeInTheDocument();
  });

  it("shows the net-negative resumo variant when a symbol's small trades net a loss", () => {
    const losingGroupSnapshot: PalcoSnapshot = {
      ...fixtureSnapshot,
      feed: [
        {
          id: 61,
          ts: 1_700_000_600_000,
          type: "trade_closed",
          html: "",
          payload: { symbol: "SOLUSDT", realizedPnlMc: -3_000, feeMc: 10, liquidated: false },
        },
        {
          id: 60,
          ts: 1_700_000_590_000,
          type: "trade_closed",
          html: "",
          payload: { symbol: "SOLUSDT", realizedPnlMc: -1_000, feeMc: 10, liquidated: false },
        },
      ],
    };
    render(<MuralTab snapshot={losingGroupSnapshot} />);
    expect(screen.getByText("🔁 Resumo da mesa SOLUSDT")).toBeInTheDocument();
    expect(screen.getByText("2 operações miúdas, saldo -$0.04. A corretora agradece as taxas.")).toBeInTheDocument();
  });

  it("skips a quiet hr_review post (zero firings and zero promotions)", () => {
    const quietReviewSnapshot: PalcoSnapshot = {
      ...fixtureSnapshot,
      feed: [
        {
          id: 62,
          ts: 1_700_000_700_000,
          type: "hr_review",
          html: "🧾 RH: 4 avaliados · 0 demitidos · 0 promovidos · 4 mantidos · benchmark 10c",
          payload: { reviewed: 4, fired: 0, promoted: 0, held: 4, benchmarkCents: 10 },
        },
      ],
    };
    render(<MuralTab snapshot={quietReviewSnapshot} />);
    expect(screen.getByText("Sem eventos ainda.")).toBeInTheDocument();
  });

  it("falls back to the pre-escaped html for an event type it doesn't model as a post", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    // "catch_up" has no headline mapping in mural-posts.ts.
    expect(screen.getByText("⏪ catch-up de 12 barras")).toBeInTheDocument();
  });

  it("renders the same post body deterministically across two separate renders (same feed, same joke)", () => {
    const { unmount } = render(<MuralTab snapshot={fixtureSnapshot} />);
    const firstRun = screen.getByText("📈 Lucro em destaque").closest("li.orkut-scrap")?.textContent;
    unmount();
    cleanup();

    render(<MuralTab snapshot={fixtureSnapshot} />);
    const secondRun = screen.getByText("📈 Lucro em destaque").closest("li.orkut-scrap")?.textContent;

    expect(firstRun).toBeTruthy();
    expect(firstRun).toBe(secondRun);
    expect(firstRun).toContain("$1.50 no bolso. Não foi sorte — foi o genoma. (Foi um pouco de sorte.)");
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

describe("MuralTab — rotação de cadeira", () => {
  it("renders an evidence-blind rotation post that never sounds like a verdict", () => {
    const snapshot = {
      ...fixtureSnapshot,
      feed: [
        {
          id: 99,
          ts: 1_700_000_600_000,
          type: "trader_rotated",
          html: "🔄 <strong>Olívia Hoffmann</strong> girou a cadeira",
          payload: {
            name: "Olívia Hoffmann",
            reason: "Rotação por falta de evidência: 5 dias sem gerar trades avaliáveis.",
            returnedMc: 20_000_000,
          },
        },
      ],
    };

    render(<MuralTab snapshot={snapshot} />);

    expect(screen.getByText("🔄 Rotação de cadeira")).toBeInTheDocument();
    expect(screen.getByText(/Olívia Hoffmann/)).toBeInTheDocument();
    // Never framed as a firing: the joke "comunidades" box legitimately
    // contains the word, so scope the check to the post headline itself.
    expect(screen.queryByText("📦 Desligamento")).toBeNull();
    expect(screen.getByText(/sem trades suficientes pra julgar|sem histórico/)).toBeInTheDocument();
  });
});
