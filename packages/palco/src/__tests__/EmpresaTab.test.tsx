import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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

    const employeeNames = Array.from(document.querySelectorAll(".org-node-name")).map(
      (el) => el.childNodes[0]?.textContent,
    );
    expect(employeeNames).toEqual(["Ada Faria", "Beto Nunes", "Caue Reis", "Rand-7"]);

    // Mesa/cargo text is intentionally NOT on the compact node (v3 Task 3
    // spec: avatar, name + mood, book mono, status chip only) — Leaderboard
    // already owns the mesa/leverage display, no need to duplicate it here.
    expect(screen.getByText("$7.00")).toBeInTheDocument(); // Ada Faria's bookMc = 700_000
    expect(screen.getByText("demitido")).toBeInTheDocument(); // Caue Reis's status
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
});
