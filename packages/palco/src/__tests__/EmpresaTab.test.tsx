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

    expect(screen.getByText("Recursos Humanos")).toBeInTheDocument();
    expect(screen.getByText(/RH baseado em evidência/)).toBeInTheDocument();
    // 1 trader_fired + 1 trader_promoted in the fixture's org.history.
    expect(screen.getAllByText("1", { selector: ".rh-counters .v" })).toHaveLength(2);
    expect(screen.getByText("demissões no ciclo")).toBeInTheDocument();
    expect(screen.getByText("promoções no ciclo")).toBeInTheDocument();
  });

  it("renders every current-generation employee as a graph node with book/status", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);

    // v3.1 restructured the graph into rows (live firm, live control, then
    // a "galeria dos caídos" fallen row) instead of two cohort columns —
    // Caue Reis (fired) now lands in the fallen row, after the two live
    // rows, rather than staying grouped with the rest of the firm cohort.
    const employeeNames = Array.from(document.querySelectorAll(".org-node-name")).map(
      (el) => el.childNodes[0]?.textContent,
    );
    expect(employeeNames).toEqual(["Ada Faria", "Beto Nunes", "Rand-7", "Caue Reis"]);

    // Mesa/leverage text is still NOT duplicated on the compact node (v3
    // Task 3 spec: Leaderboard already owns that display) — but v3.2 adds a
    // cargo.titulo line (job title, not mesa) between the name and the book.
    expect(screen.getByText("$7.00")).toBeInTheDocument(); // Ada Faria's bookMc = 700_000
    expect(screen.getByText("demitido")).toBeInTheDocument(); // Caue Reis's status
  });

  it("renders each employee's cargo.titulo (job title) on its compact node — Beto Nunes is an HR mid-cycle trainee", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);

    const betoNode = orgNodeByEmployeeName("Beto Nunes");
    expect(betoNode.querySelector(".org-node-cargo")).toHaveTextContent("Trader Trainee · aposta do RH");
  });

  it("renders a compact, mono explainer above the graph describing how the firm is organized", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText(/Como a firma se organiza/)).toBeInTheDocument();
  });

  it("renders the RH node top-of-graph with hrPolicy as a title tooltip", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    const rhNode = screen.getByTitle(fixtureSnapshot.org.hrPolicy);
    expect(rhNode).toHaveTextContent("RH");
  });

  it("draws an animated mutation lineage edge labeled \"mutação\", tooltipped with the resolved parentName", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText("mutação")).toBeInTheDocument();

    const betoNode = orgNodeByEmployeeName("Beto Nunes");
    expect(betoNode).toHaveAttribute("title", "↳ mutação de Ada Faria");
  });

  it("tooltips an external-hire lineage note for a null-parent, fresh-seedNote employee", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    const adaNode = orgNodeByEmployeeName("Ada Faria");
    expect(adaNode).toHaveAttribute("title", "↳ contratação externa (genoma novo)");
  });

  it("never tooltips a lineage note for the control cohort", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    const randNode = orgNodeByEmployeeName("Rand-7");
    expect(randNode).not.toHaveAttribute("title");
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
