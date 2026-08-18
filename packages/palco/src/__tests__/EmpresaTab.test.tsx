import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmpresaTab } from "../tabs/EmpresaTab";
import { fixtureSnapshot } from "./fixtures";

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

  it("renders every current-generation employee with cargo/book/status", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);

    // Names also appear inside org.history's html rows (e.g. "Ada Faria
    // promovido(a)"), so scope these assertions to the employee cards.
    const employeeNames = Array.from(document.querySelectorAll(".employee-name")).map((el) => el.textContent);
    expect(employeeNames).toEqual(["Ada Faria", "Beto Nunes", "Caue Reis", "Rand-7"]);

    expect(screen.getByText("Mesa BTCUSDT · 2x")).toBeInTheDocument();
    expect(screen.getByText("$7.00")).toBeInTheDocument(); // Ada Faria's bookMc = 700_000
    expect(screen.getByText("demitido")).toBeInTheDocument(); // Caue Reis's status
  });

  it("shows a mutation lineage line naming the resolved parentName", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText("↳ mutação de Ada Faria")).toBeInTheDocument();
  });

  it("shows an external-hire lineage line for a null-parent, fresh-seedNote employee", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText("↳ contratação externa (genoma novo)")).toBeInTheDocument();
  });

  it("never shows a lineage line for the control cohort", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    const randCard = screen.getByText("Rand-7").closest(".employee-card");
    expect(randCard?.querySelector(".lineage-line")).toBeNull();
  });

  it("renders org.history as a compact timeline", () => {
    render(<EmpresaTab snapshot={fixtureSnapshot} />);
    expect(screen.getByText("Histórico")).toBeInTheDocument();
    expect(screen.getByText(/Geração 3 \(evolved\) começou/)).toBeInTheDocument();
  });

  it("renders empty-state copy when there is no snapshot yet", () => {
    render(<EmpresaTab snapshot={null} />);
    expect(screen.getAllByText("Sem funcionários ainda.").length).toBe(2);
    expect(screen.getByText("Sem histórico ainda.")).toBeInTheDocument();
  });
});
