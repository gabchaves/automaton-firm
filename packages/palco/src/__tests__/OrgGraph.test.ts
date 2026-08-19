import { describe, expect, it } from "vitest";
import { buildGraph } from "../tabs/OrgGraph";
import type { Employee } from "../lineage";

/**
 * Regression test for the v4 plan's Task B1 clipping bug: the "Encerrados"
 * row grows unbounded over a generation's life (fed continuously by HR
 * rotation), and the v3.1 layout used fixed, hand-tuned Y coordinates that
 * didn't account for that. This exercises `buildGraph` directly — the pure
 * layout function behind OrgGraph.tsx's <ReactFlow> — with a 13-employee
 * fixture spread across all three tiers (firm/control/encerrados), and
 * asserts NO two rendered nodes' bounding boxes overlap. A plain node-count
 * assertion wouldn't catch the original bug (the row always contained the
 * right number of nodes; the problem was the viewport, not the count), so
 * this computes actual axis-aligned bounding boxes from each node's
 * `position` + `measured` (both explicit numbers set by buildGraph itself,
 * not something that needs a live DOM layout to observe).
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

/** Builds a fixture with `firmCount` live firm traders, `controlCount` live
 * control traders, and `fallenCount` dead/fired employees (alternating
 * cohort + dead/fired so both branches of the "Encerrados" filter are
 * exercised) — enough to spread across all three tiers per the plan's
 * "10+ funcionários espalhados entre firma/controle/encerrados" ask. */
function buildFixture(firmCount: number, controlCount: number, fallenCount: number): Employee[] {
  const firm = Array.from({ length: firmCount }, (_, i) =>
    makeEmployee({ traderId: `firm-${i}`, name: `Firma ${i}`, cohort: "evolved", status: "live" }),
  );
  const control = Array.from({ length: controlCount }, (_, i) =>
    makeEmployee({ traderId: `control-${i}`, name: `Controle ${i}`, cohort: "random", status: "live" }),
  );
  const fallen = Array.from({ length: fallenCount }, (_, i) =>
    makeEmployee({
      traderId: `fallen-${i}`,
      name: `Caido ${i}`,
      cohort: i % 2 === 0 ? "evolved" : "random",
      status: i % 3 === 0 ? "dead" : "fired",
    }),
  );
  return [...firm, ...control, ...fallen];
}

interface Rect {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function toRect(node: { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number } }): Rect {
  const width = node.measured?.width ?? 0;
  const height = node.measured?.height ?? 0;
  return { id: node.id, x1: node.position.x, y1: node.position.y, x2: node.position.x + width, y2: node.position.y + height };
}

/** Strict AABB overlap — nodes that merely touch at an edge (shared
 * boundary, zero-area intersection) don't count, only a real overlap does. */
function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

function findOverlaps(rects: Rect[]): Array<[string, string]> {
  const overlaps: Array<[string, string]> = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j])) overlaps.push([rects[i].id, rects[j].id]);
    }
  }
  return overlaps;
}

const NOOP_SELECT = () => {};

describe("buildGraph — layout regression (v4 Task B1)", () => {
  it("renders 13 employees spread across firm/control/encerrados with zero bounding-box overlap between any two nodes", () => {
    const employees = buildFixture(4, 3, 6); // 13 total, 10+ per the plan
    const { nodes } = buildGraph(employees, "policy", 2, 1, NOOP_SELECT, 100_000, []);

    // Sanity: every tier actually produced nodes (a false "no overlap"
    // result from an empty graph would be worthless).
    expect(nodes.length).toBeGreaterThan(13); // + RH node + RH caption + 3 section-header captions

    const rects = nodes.map(toRect);
    expect(findOverlaps(rects)).toEqual([]);
  });

  it("keeps zero overlap as the Encerrados row grows well past the other tiers (HR rotation over time — the original bug's exact scenario)", () => {
    const employees = buildFixture(2, 2, 30); // Encerrados much longer than the live rows
    const { nodes } = buildGraph(employees, "policy", 10, 0, NOOP_SELECT, 100_000, []);

    const rects = nodes.map(toRect);
    expect(findOverlaps(rects)).toEqual([]);
  });

  it("labels every non-empty tier with its own header caption node, not just spatial grouping", () => {
    const employees = buildFixture(2, 2, 2);
    const { nodes } = buildGraph(employees, "policy", 1, 1, NOOP_SELECT, 100_000, []);

    const captionTexts = nodes.filter((n) => n.type === "caption").map((n) => (n.data as { text: string }).text);
    expect(captionTexts).toEqual(["Recursos Humanos", "A Firma", "Controle", "Encerrados"]);
  });

  it("omits a tier's header when that tier has no employees (no live control cohort this generation)", () => {
    const employees = buildFixture(3, 0, 2);
    const { nodes } = buildGraph(employees, "policy", 1, 0, NOOP_SELECT, 100_000, []);

    const captionTexts = nodes.filter((n) => n.type === "caption").map((n) => (n.data as { text: string }).text);
    expect(captionTexts).toEqual(["Recursos Humanos", "A Firma", "Encerrados"]);

    const rects = nodes.map(toRect);
    expect(findOverlaps(rects)).toEqual([]);
  });

  it("gives the RH node its own caption above it, distinct from the row-tier headers", () => {
    const employees = buildFixture(1, 1, 0);
    const { nodes } = buildGraph(employees, "policy", 0, 0, NOOP_SELECT, 100_000, []);

    const rhCaption = nodes.find((n) => n.id === "rh-caption");
    const rhNode = nodes.find((n) => n.id === "rh");
    expect(rhCaption).toBeDefined();
    expect((rhCaption?.data as { text: string }).text).toBe("Recursos Humanos");
    // The caption sits directly above the RH node — same horizontal center,
    // strictly smaller y, and the two never overlap each other.
    expect(rhCaption?.position.y).toBeLessThan(rhNode?.position.y ?? 0);
    expect(findOverlaps([toRect(rhCaption!), toRect(rhNode!)])).toEqual([]);
  });
});
