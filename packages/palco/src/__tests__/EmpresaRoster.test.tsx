import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { buildRoster, EmpresaRoster } from "../tabs/EmpresaRoster";
import type { Employee } from "../lineage";

/**
 * v4.3 plan: replaces OrgGraph.test.tsx's xyflow-specific tests (zoom/
 * bounding-box assertions no longer apply — there's no canvas). Covers the
 * plain-list version instead: the ordering algorithm (shared with the
 * Leaderboard via row-order.ts, mirroring leaderboard-order.test.ts's
 * adversarial regression), the single "Encerrados" divider, the lineage
 * line's visible-text branches, and that a row click still opens the
 * profile drawer.
 */

function makeEmployee(overrides: Partial<Employee>): Employee {
  return {
    traderId: "t-default",
    name: "Default Trader",
    cohort: "evolved",
    slot: 0,
    status: "live",
    bookMc: 100_000,
    symbol: "BTCUSDT",
    leverage: 2,
    bornAt: 1_699_000_000_000,
    diedAt: null,
    parentTraderId: null,
    parentName: null,
    seedNote: "fresh",
    ...overrides,
  };
}

describe("buildRoster", () => {
  it("v4.1/v4.3 regression (ported from leaderboard-order.test.ts): a closed seat from cohort A never outranks a live seat from cohort B — closed seats land at the true end of the WHOLE roster, not just their own cohort's block", () => {
    const employees = [
      makeEmployee({ traderId: "e-live", name: "Evolved Live", cohort: "evolved", status: "live", bookMc: 300_000 }),
      makeEmployee({
        traderId: "e-fired",
        name: "Evolved Fired",
        cohort: "evolved",
        status: "fired",
        bookMc: 900_000,
      }),
      makeEmployee({ traderId: "r-live", name: "Random Live", cohort: "random", status: "live", bookMc: 50_000 }),
    ];

    const { firmLive, controlLive, closed } = buildRoster(employees);
    expect(firmLive.map((e) => e.name)).toEqual(["Evolved Live"]);
    expect(controlLive.map((e) => e.name)).toEqual(["Random Live"]);
    // "Evolved Fired" has the HIGHEST book of the three but must still sit
    // in `closed`, never in `firmLive` — a closed seat from one cohort must
    // never outrank a live seat from the OTHER cohort either.
    expect(closed.map((e) => e.name)).toEqual(["Evolved Fired"]);
  });

  it("groups live rows by cohort (book desc within cohort) and puts every closed seat from both cohorts together, fired before dead, book desc within tier", () => {
    const employees = [
      makeEmployee({
        traderId: "f1",
        name: "Evolved Fired Big",
        cohort: "evolved",
        status: "fired",
        bookMc: 500_000,
      }),
      makeEmployee({ traderId: "d1", name: "Random Dead", cohort: "random", status: "dead", bookMc: 0 }),
      makeEmployee({
        traderId: "l1",
        name: "Evolved Live Small",
        cohort: "evolved",
        status: "live",
        bookMc: 50_000,
      }),
      makeEmployee({
        traderId: "l2",
        name: "Evolved Live Big",
        cohort: "evolved",
        status: "live",
        bookMc: 400_000,
      }),
      makeEmployee({ traderId: "l3", name: "Random Live", cohort: "random", status: "live", bookMc: 10_000 }),
      makeEmployee({
        traderId: "f2",
        name: "Random Fired Small",
        cohort: "random",
        status: "fired",
        bookMc: 10_000,
      }),
    ];

    const { firmLive, controlLive, closed } = buildRoster(employees);
    expect(firmLive.map((e) => e.name)).toEqual(["Evolved Live Big", "Evolved Live Small"]);
    expect(controlLive.map((e) => e.name)).toEqual(["Random Live"]);
    expect(closed.map((e) => e.name)).toEqual(["Evolved Fired Big", "Random Fired Small", "Random Dead"]);
  });

  it("returns empty groups, no crash, for an empty roster", () => {
    expect(buildRoster([])).toEqual({ firmLive: [], controlLive: [], closed: [] });
  });
});

describe("EmpresaRoster", () => {
  it("renders each row as a plain list item — avatar, name, mood emoji, cargo, book, status chip — the same card the graph used to render as xyflow nodes", () => {
    const employees = [
      makeEmployee({ traderId: "t1", name: "Ada Faria", cohort: "evolved", status: "live", bookMc: 700_000 }),
    ];
    render(<EmpresaRoster employees={employees} leaderboard={[]} stakeMc={200_000} />);

    const row = document.querySelector(".roster-row .org-node");
    expect(row).not.toBeNull();
    expect(row?.querySelector(".org-node-avatar")).not.toBeNull();
    expect(row?.querySelector(".org-node-name")?.textContent).toContain("Ada Faria");
    expect(row?.querySelector(".mood-emoji")).not.toBeNull();
    expect(row?.querySelector(".org-node-cargo")).not.toBeNull();
    expect(row?.querySelector(".org-node-book")?.textContent).toBe("$7.00");
    expect(row?.querySelector(".status-chip")?.textContent).toBe("vivo");
  });

  it("renders 'A Firma'/'Controle' section headers for the live groups, omitting a cohort's header entirely when it has no live employees", () => {
    const employees = [makeEmployee({ traderId: "t1", name: "Firm One", cohort: "evolved", status: "live" })];
    render(<EmpresaRoster employees={employees} leaderboard={[]} stakeMc={200_000} />);

    const titles = Array.from(document.querySelectorAll(".roster-section-title")).map((el) => el.textContent);
    expect(titles).toEqual(["A Firma"]);
  });

  it("renders exactly one 'Encerrados' divider header, only when a closed seat exists anywhere in the roster", () => {
    const allLive = [makeEmployee({ traderId: "t1", name: "Live One", status: "live" })];
    const { unmount } = render(<EmpresaRoster employees={allLive} leaderboard={[]} stakeMc={200_000} />);
    expect(document.querySelectorAll(".org-fallen-header").length).toBe(0);
    unmount();

    const withClosed = [
      makeEmployee({ traderId: "t1", name: "Live One", status: "live" }),
      makeEmployee({ traderId: "t2", name: "Fired One", status: "fired" }),
    ];
    render(<EmpresaRoster employees={withClosed} leaderboard={[]} stakeMc={200_000} />);
    const headers = document.querySelectorAll(".org-fallen-header");
    expect(headers.length).toBe(1);
    expect(headers[0].textContent).toBe("Encerrados");
  });

  it("renders the lineage line's visible-text branches: mutação de X, contratação externa, seedNote fallback, and none for the control cohort", () => {
    const employees = [
      makeEmployee({
        traderId: "mut",
        name: "Mutated",
        cohort: "evolved",
        status: "live",
        parentTraderId: "parent-x",
        parentName: "Parent X",
      }),
      makeEmployee({
        traderId: "ext",
        name: "External",
        cohort: "evolved",
        status: "live",
        parentTraderId: null,
        seedNote: "fresh",
      }),
      makeEmployee({
        traderId: "seed",
        name: "Seeded",
        cohort: "evolved",
        status: "live",
        parentTraderId: null,
        seedNote: "2 clones + 1 mutant",
      }),
      makeEmployee({ traderId: "rand", name: "Randy", cohort: "random", status: "live" }),
    ];
    render(<EmpresaRoster employees={employees} leaderboard={[]} stakeMc={200_000} />);

    function lineageFor(name: string): string | null {
      const nameEl = Array.from(document.querySelectorAll(".org-node-name")).find(
        (el) => el.childNodes[0]?.textContent === name,
      );
      const row = nameEl?.closest(".roster-row");
      return row?.querySelector(".roster-row-lineage")?.textContent ?? null;
    }

    expect(lineageFor("Mutated")).toBe("↳ mutação de Parent X");
    expect(lineageFor("External")).toBe("↳ contratação externa (genoma novo)");
    expect(lineageFor("Seeded")).toBe("↳ geração evoluída — 2 clones + 1 mutant");
    expect(lineageFor("Randy")).toBeNull();
  });

  it("opens the profile drawer with the right trader when a live row is clicked", () => {
    const employees = [makeEmployee({ traderId: "t1", name: "Click Target", cohort: "evolved", status: "live" })];
    render(<EmpresaRoster employees={employees} leaderboard={[]} stakeMc={200_000} />);

    fireEvent.click(document.querySelector(".org-node")!);

    expect(document.querySelector(".empresa-drawer-name")?.textContent).toBe("Click Target");
  });

  it("also opens the drawer when a closed (Encerrados) row is clicked", () => {
    const employees = [
      makeEmployee({ traderId: "t1", name: "Live One", status: "live" }),
      makeEmployee({ traderId: "t2", name: "Fired Two", status: "fired" }),
    ];
    render(<EmpresaRoster employees={employees} leaderboard={[]} stakeMc={200_000} />);

    const rows = document.querySelectorAll(".org-node");
    fireEvent.click(rows[rows.length - 1]);

    expect(document.querySelector(".empresa-drawer-name")?.textContent).toBe("Fired Two");
  });
});
