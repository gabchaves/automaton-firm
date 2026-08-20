import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EmpresaTab } from "../tabs/EmpresaTab";
import { fixtureSnapshot } from "./fixtures";

/** The mood-emoji span (v3 fun-pass addendum) sits inside `.org-node-name`
 * right after the name text, so a plain `.textContent` check would pick up
 * the emoji too. Employee names also appear a second time inside
 * `org.history`'s pre-escaped html rows (e.g. "Ada Faria promovido(a)"), so
 * `screen.getByText` alone would find two matches — scope through the
 * node's own first text child instead, same reasoning the pre-graph test
 * used for its `.employee-name` selector. */
function orgNodeByEmployeeName(name: string): HTMLElement {
  const nameEl = Array.from(document.querySelectorAll(".org-node-name")).find(
    (el) => el.childNodes[0]?.textContent === name,
  );
  const node = nameEl?.closest(".org-node");
  if (!node) throw new Error(`no .org-node found for employee "${name}"`);
  return node as HTMLElement;
}

describe("EmpresaTab", () => {
  it("renders the RH card with the exact policy string and ciclo counters from org.history", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);

    expect(screen.getByText("Recursos Humanos", { selector: ".rh-card .section-title" })).toBeInTheDocument();
    expect(screen.getByText(/RH baseado em evidência/)).toBeInTheDocument();
    // 1 trader_fired + 1 trader_promoted in the fixture's org.history.
    expect(screen.getAllByText("1", { selector: ".rh-counters .v" })).toHaveLength(2);
    expect(screen.getByText("demissões no ciclo")).toBeInTheDocument();
    expect(screen.getByText("promoções no ciclo")).toBeInTheDocument();

    // v4.3: RH's "unmistakable" treatment (icon + live countdown) used to
    // live on the graph's separate RH node (removed) — it moved here, its
    // one on-page home now.
    expect(document.querySelector(".rh-card .org-rh-icon")).toBeInTheDocument();
    expect(screen.getByText(/próxima avaliação em \d+h\d{2}/, { selector: ".rh-next-review" })).toBeInTheDocument();
  });

  it("renders the CEO card as whoever currently leads the book — Ada Faria in the fixture — not a vacant seat", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);

    // "CEO" is now a small role kicker (the site's plain .label chip), not
    // the card's headline — the headline slot belongs to the name (Ada
    // Faria), matching RH's one-headline pattern.
    expect(screen.getByText("CEO", { selector: ".ceo-card .label" })).toBeInTheDocument();
    // Ada Faria: evolved, live, bookMc 700_000, realizedPnlMc 120_000,
    // tradesCount 14 — the highest book among the fixture's live evolved
    // traders. All three counters are plain (no red/green by sign) —
    // matching RH's own counters, which never colored by sign either.
    expect(screen.getByText("Ada Faria", { selector: ".ceo-name.section-title" })).toBeInTheDocument();
    expect(screen.getByText("$7.00", { selector: ".ceo-card .rh-counters .v" })).toBeInTheDocument();
    expect(screen.getByText("$1.20", { selector: ".ceo-card .rh-counters .v" })).toBeInTheDocument();
    expect(screen.getByText("14", { selector: ".ceo-card .rh-counters .v" })).toBeInTheDocument();
    expect(screen.getByText("lucro realizado")).toBeInTheDocument();
    expect(screen.getByText("trades no ciclo")).toBeInTheDocument();
    expect(screen.getByText(/Eleito pelo mercado, não por currículo/)).toBeInTheDocument();
    expect(screen.getByText(/muda de mãos toda vez que alguém supera/)).toBeInTheDocument();
  });

  it("falls back to a contested-seat message when no live evolved trader exists", () => {
    const noEvolvedLeader = {
      ...fixtureSnapshot,
      leaderboard: fixtureSnapshot.leaderboard.filter((entry) => entry.cohort !== "evolved" || entry.status !== "live"),
    };
    render(<EmpresaTab snapshot={noEvolvedLeader} />);

    expect(screen.getByText(/Cargo em disputa/)).toBeInTheDocument();
    expect(screen.queryByText("Ada Faria", { selector: ".ceo-name" })).not.toBeInTheDocument();
  });

  it("renders every current-generation employee as a plain roster row with book/status", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);

    // v4.3: plain tidy list, same ordering contract as the Leaderboard
    // (row-order.ts) — live rows grouped by cohort (Ada/Beto = evolved live,
    // Rand-7 = random live), then every closed seat at the true end
    // (Caue Reis, fired), regardless of cohort.
    const employeeNames = Array.from(document.querySelectorAll(".org-node-name")).map(
      (el) => el.childNodes[0]?.textContent,
    );
    expect(employeeNames).toEqual(["Ada Faria", "Beto Nunes", "Rand-7", "Caue Reis"]);

    // Mesa/leverage text is still NOT duplicated on the compact node (v3
    // Task 3 spec: Leaderboard already owns that display) — but v3.2 adds a
    // cargo.titulo line (job title, not mesa) between the name and the book.
    // Scoped to the roster row (not the CEO card, which now also shows Ada's $7.00 book).
    expect(screen.getByText("$7.00", { selector: ".org-node-book" })).toBeInTheDocument();
    expect(screen.getByText("demitido")).toBeInTheDocument(); // Caue Reis's status
  });

  it("renders each employee's cargo.titulo (job title) on its compact node — Beto Nunes is an HR mid-cycle trainee", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);

    const betoNode = orgNodeByEmployeeName("Beto Nunes");
    expect(betoNode.querySelector(".org-node-cargo")).toHaveTextContent("Trader Trainee · aposta do RH");
  });

  it("renders a compact, mono explainer above the roster describing how the firm is organized", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText(/Como a firma se organiza/)).toBeInTheDocument();
  });

  // v4.3: the lineage line used to be a hover-only tooltip on the graph
  // node (`title` attribute) plus, for a bred mutation, an animated edge
  // labeled "mutação". The graph is gone — `lineageLine`'s branch logic is
  // unchanged, but it renders as plain visible text under each row now
  // (see EmpresaRoster.test.tsx for the row-level unit coverage; this is
  // just the EmpresaTab-level wiring smoke test).
  it("renders a visible lineage line under a bred (mutação) employee's row, naming the resolved parent", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    const betoRow = orgNodeByEmployeeName("Beto Nunes").closest(".roster-row");
    expect(betoRow?.querySelector(".roster-row-lineage")).toHaveTextContent("↳ mutação de Ada Faria");
  });

  it("renders a visible external-hire lineage line for a null-parent, fresh-seedNote employee", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    const adaRow = orgNodeByEmployeeName("Ada Faria").closest(".roster-row");
    expect(adaRow?.querySelector(".roster-row-lineage")).toHaveTextContent("↳ contratação externa (genoma novo)");
  });

  it("never renders a lineage line for the control cohort", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    const randRow = orgNodeByEmployeeName("Rand-7").closest(".roster-row");
    expect(randRow?.querySelector(".roster-row-lineage")).toBeNull();
  });

  it("renders org.history as a compact timeline", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText("Histórico")).toBeInTheDocument();
    expect(screen.getByText(/Geração 3 \(evolved\) começou/)).toBeInTheDocument();
  });

  it("renders empty-state copy when there is no snapshot yet", () => {
    render(<EmpresaTab snapshot={null} />);
    expect(screen.getByText("Sem funcionários ainda.")).toBeInTheDocument();
    expect(screen.getByText("Sem histórico ainda.")).toBeInTheDocument();
  });

  describe("profile drawer (v3.1)", () => {
    it("opens Ada Faria's profile on node click, showing her name, a readable genome chip, and her achievements — then closes on Esc", async () => {
      render(<EmpresaTab snapshot={fixtureSnapshot} />);

      fireEvent.click(orgNodeByEmployeeName("Ada Faria"));

      expect(screen.getByText("Ada Faria", { selector: ".empresa-drawer-name" })).toBeInTheDocument();
      // Ada's genome (fixture): momentum fastBars=8/slowBars=34 + breakout channelBars=20.
      expect(screen.getByText("⚡ Momentum 8/34 barras")).toBeInTheDocument();
      expect(screen.getByText("✨ Primeira semana viva")).toBeInTheDocument();
      expect(screen.queryByText("nenhuma conquista ainda")).not.toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() =>
        expect(screen.queryByText("Ada Faria", { selector: ".empresa-drawer-name" })).not.toBeInTheDocument(),
      );
    });

    it("falls back to a 'sem dados de mesa' note when the clicked employee has no matching leaderboard row", () => {
      render(<EmpresaTab snapshot={fixtureSnapshot} />);

      // Beto Nunes is in org.employees but not in the fixture's (2-entry)
      // leaderboard — the drawer must degrade gracefully, not crash/blank.
      fireEvent.click(orgNodeByEmployeeName("Beto Nunes"));

      expect(screen.getByText("Beto Nunes", { selector: ".empresa-drawer-name" })).toBeInTheDocument();
      expect(screen.getByText("sem dados de mesa desta geração")).toBeInTheDocument();
    });

    it("shows the cargo.titulo chip and a 'Papel na firma' section for Beto Nunes (HR mid-cycle trainee)", () => {
      render(<EmpresaTab snapshot={fixtureSnapshot} />);

      fireEvent.click(orgNodeByEmployeeName("Beto Nunes"));

      expect(screen.getByText("Trader Trainee · aposta do RH", { selector: ".empresa-drawer-titulo" })).toBeInTheDocument();
      expect(screen.getByText("Papel na firma")).toBeInTheDocument();
      expect(screen.getByText(/Contratado\(a\) no meio do ciclo como mutação do melhor genoma vivo/)).toBeInTheDocument();
      // No leaderboard row for Beto — families: [], so the mesa clause is
      // still there but no specialty sentence gets fabricated.
      expect(screen.getByText(/Mesa ETHUSDT · 1x\.$/)).toBeInTheDocument();
    });

    it("shows Ada Faria's cargo.titulo and a multi-strategist papel derived from her momentum+breakout genome", () => {
      render(<EmpresaTab snapshot={fixtureSnapshot} />);

      fireEvent.click(orgNodeByEmployeeName("Ada Faria"));

      expect(screen.getByText("Trader Júnior · contratação externa", { selector: ".empresa-drawer-titulo" })).toBeInTheDocument();
      expect(screen.getByText(/Multiestrategista: combina momentum\/breakout\./)).toBeInTheDocument();
    });
  });
});
