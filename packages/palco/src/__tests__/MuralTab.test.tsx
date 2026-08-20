import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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
    // $1.50 (fixture id 50) is above this fixture's $0.20 individual-post
    // threshold (2% of cards.genStartMc = 1_000_000) — mulberry32(50)
    // deterministically picks this exact pool line (v4.6's 10-variant win
    // pool shifted the index; still the same deterministic pick per id).
    expect(
      screen.getByText("BTCUSDT pagou bem hoje: $1.50 garantidos, sem estresse extra pro genoma."),
    ).toBeInTheDocument();
  });

  it("derives the small-trade threshold from cards.genStartMc: the fixture's $1.50 win clears its $0.20 threshold as an individual post, while the small ETHUSDT pair (well under it) still collapses into one grouped balanço", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);

    // Big win: its own spotlight post, never folded into a grouped balanço.
    expect(screen.getByText("📈 Lucro em destaque")).toBeInTheDocument();
    const bigWinScrap = screen.getByText("📈 Lucro em destaque").closest("li.orkut-scrap");
    expect(bigWinScrap?.textContent).not.toContain("Balanço do dia");

    // Small trades (id 42: +$0.02, id 39: -$0.01 — both well under $0.20):
    // collapsed into exactly one grouped "balanço do dia" post.
    expect(screen.getByText("🔁 Balanço do dia")).toBeInTheDocument();
    const groupedScraps = Array.from(document.querySelectorAll("li.orkut-scrap")).filter((li) =>
      li.textContent?.includes("Balanço do dia"),
    );
    expect(groupedScraps).toHaveLength(1);
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
    // mulberry32(49) deterministically picks this exact pool line (v4.6's
    // 6-variant fired pool shifted the index; still the same deterministic
    // pick per id).
    expect(
      screen.getByText("Caue Reis foi desligado(a) com $0.80 de saldo devolvido. Sem drama: é darwinismo com CNPJ imaginário."),
    ).toBeInTheDocument();
    expect(screen.getByText("underperformance sustentada")).toBeInTheDocument();
    // RH is the post's author, not the fired employee.
    expect(screen.getAllByText("RH").length).toBeGreaterThan(0);
  });

  it("collapses small same-symbol trades into one grouped post, even when they aren't consecutive in the feed", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    // Fixture has two small ETHUSDT trade_closed events (id 42: +$0.02, id
    // 39: -$0.01 — net +$0.01, count 2), separated by several unrelated
    // events (including id 41's dropped trade_opened). Neither carries a
    // traderName in this fixture, so both fall back to grouping by symbol
    // (v4.7's real behavior groups by trader when traderName is present —
    // see mural-posts.test.ts) — they still collapse into exactly ONE post.
    expect(screen.getByText("🔁 Balanço do dia")).toBeInTheDocument();
    expect(
      screen.getByText("2 operações miúdas, saldo $0.01. Formiguinha também é lucro."),
    ).toBeInTheDocument();
    const groupedScraps = document.querySelectorAll("li.orkut-scrap");
    const matching = Array.from(groupedScraps).filter((li) => li.textContent?.includes("Balanço do dia"));
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

  it("shows the net-negative variant when a symbol's small trades net a loss", () => {
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
    expect(screen.getByText("🔁 Balanço do dia")).toBeInTheDocument();
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
    expect(firstRun).toContain("BTCUSDT pagou bem hoje: $1.50 garantidos, sem estresse extra pro genoma.");
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

  it("renders a deterministic karma number next to the author name, identical across two separate renders (v4 Task B2)", () => {
    const { unmount } = render(<MuralTab snapshot={fixtureSnapshot} />);
    const firstKarma = screen.getByText("📈 Lucro em destaque").closest("li.orkut-scrap")?.querySelector(".orkut-karma")
      ?.textContent;
    unmount();
    cleanup();

    render(<MuralTab snapshot={fixtureSnapshot} />);
    const secondKarma = screen
      .getByText("📈 Lucro em destaque")
      .closest("li.orkut-scrap")
      ?.querySelector(".orkut-karma")?.textContent;

    expect(firstKarma).toBeTruthy();
    expect(firstKarma).toMatch(/^★ \d+ karma$/);
    expect(firstKarma).toBe(secondKarma);
  });

  it("gives every post its own karma badge in the title bar", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    const karmaBadges = document.querySelectorAll(".orkut-karma");
    expect(karmaBadges.length).toBe(10); // one per post, same count as "scraps (10)"
  });

  it("expands the visitor counter into a 'visitas recentes' line with 2-3 names from the known trader roster", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    const line = screen.getByText(/visitas recentes:/);
    expect(line).toBeInTheDocument();
    // fixtureSnapshot's org.employees: Ada Faria, Beto Nunes, Caue Reis, Rand-7.
    const knownNames = ["Ada Faria", "Beto Nunes", "Caue Reis", "Rand-7"];
    const mentioned = knownNames.filter((name) => line.textContent?.includes(name));
    expect(mentioned.length).toBeGreaterThanOrEqual(2);
    expect(mentioned.length).toBeLessThanOrEqual(3);
  });

  it("renders the same 'visitas recentes' names deterministically across two separate renders", () => {
    const { unmount } = render(<MuralTab snapshot={fixtureSnapshot} />);
    const first = screen.getByText(/visitas recentes:/).textContent;
    unmount();
    cleanup();

    render(<MuralTab snapshot={fixtureSnapshot} />);
    const second = screen.getByText(/visitas recentes:/).textContent;

    expect(first).toBe(second);
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
    // v4's expanded pool (6 variants as of v4.6) always names the ABSENCE
    // of evidence explicitly (see muralVoice.ts's traderRotatedBody), so
    // this holds regardless of which line mulberry32(99) actually picks —
    // and none of them reach for verdict/performance language.
    const rotationPost = screen.getByText("🔄 Rotação de cadeira").closest("li.orkut-scrap");
    expect(rotationPost?.textContent).toMatch(/evidência/i);
    expect(rotationPost?.textContent).not.toMatch(/desempenho|performance|mau trader/i);
  });
});

describe("MuralTab — carregar mais / pagination (v4.2 Task 2b)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("shows a 'ver mais scraps' button below the scrap list", () => {
    render(<MuralTab snapshot={fixtureSnapshot} />);
    expect(screen.getByRole("button", { name: "ver mais scraps" })).toBeInTheDocument();
  });

  it("fetches the next page from the oldest rendered event id, and appends older posts without losing or duplicating already-rendered ones", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          feed: [
            {
              id: 38,
              ts: 1_699_999_900_000,
              type: "trader_promoted",
              html: "",
              payload: { name: "Zara Lima", title: "Trader do Ciclo" },
            },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MuralTab snapshot={fixtureSnapshot} />);
    // Sanity check on the pre-click state (matches the "less frequent pass"
    // fixture comment atop MuralTab tests above: 10 posts before any page load).
    expect(screen.getByText("scraps (10)")).toBeInTheDocument();
    expect(screen.getByText("📈 Lucro em destaque")).toBeInTheDocument();
    expect(screen.getByText("📦 Desligamento")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ver mais scraps" }));

    // fixtureSnapshot's oldest rendered event is id 39 — that's the
    // `before` the click must ask for, with the default page size.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/feed?before=39&limit=20"));
    await waitFor(() => expect(screen.getByText("scraps (11)")).toBeInTheDocument());

    // Every pre-existing post is still there — nothing lost, nothing
    // re-keyed/duplicated by the re-render.
    expect(screen.getByText("📈 Lucro em destaque")).toBeInTheDocument();
    expect(screen.getByText("📦 Desligamento")).toBeInTheDocument();
    expect(screen.getByText("🔁 Balanço do dia")).toBeInTheDocument();

    // The fetched older post is appended.
    expect(screen.getByText("🏆 Promoção")).toBeInTheDocument();
    expect(screen.getByText("Zara Lima", { selector: ".orkut-author-link" })).toBeInTheDocument();

    // The page came back shorter than the requested limit -> no more pages.
    expect(screen.queryByRole("button", { name: "ver mais scraps" })).not.toBeInTheDocument();
  });

  it("keeps the button visible when a full page comes back — there may still be more to load", async () => {
    const fullPage = Array.from({ length: 20 }, (_, i) => ({
      id: 38 - i,
      ts: 1_699_999_900_000 - i,
      type: "catch_up",
      html: `⏪ catch-up de ${i} barras`,
      payload: { fromTs: 0, toTs: 1, bars: i },
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ feed: fullPage }) }),
    );

    render(<MuralTab snapshot={fixtureSnapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "ver mais scraps" }));

    await waitFor(() => expect(screen.getByText("scraps (30)")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "ver mais scraps" })).toBeInTheDocument();
  });

  it("disables the button and shows a loading label while the fetch is in flight", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(pending.then(() => ({ ok: true, json: () => Promise.resolve({ feed: [] }) }))),
    );

    render(<MuralTab snapshot={fixtureSnapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "ver mais scraps" }));

    const button = await screen.findByRole("button", { name: "carregando..." });
    expect(button).toBeDisabled();

    resolveFetch(undefined);
    // An empty page (0 < limit) means no more pages: the button disappears
    // once the in-flight request resolves.
    await waitFor(() => expect(screen.queryByRole("button")).not.toBeInTheDocument());
  });
});
