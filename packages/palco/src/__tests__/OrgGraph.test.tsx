import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { getNodesBounds, getViewportForBounds } from "@xyflow/react";
import { buildGraph, OrgGraph, VIEWPORT_MIN_ZOOM, FIT_VIEW_OPTIONS } from "../tabs/OrgGraph";
import type { Employee } from "../lineage";

/**
 * Regression tests for v4.2 Task 1: the v4 Task B1 dagre-era fix (re-run
 * fitView on roster change + a very low `minZoom` floor) made an unbounded
 * "Encerrados" row technically non-overlapping, but it didn't fix the
 * user's actual complaint ("o organograma ainda ta muito amontoado"/still
 * too crowded) — fitting an ever-growing Encerrados row into one viewport
 * forces fitView to zoom out further and further as it grows, shrinking
 * EVERY node, including the small live tiers, toward illegibility. Nothing
 * overlapped, but you couldn't read it either.
 *
 * The v4.2 fix moves "Encerrados" (dead/fired, either cohort) out of the
 * xyflow canvas entirely — `buildGraph` now only ever produces nodes for
 * RH + the two LIVE tiers (both capped at ROSTER_SIZE = 5,
 * src/motor/cohort.ts), and Encerrados renders as a plain scrollable HTML
 * list in the `OrgGraph` component instead (see OrgGraph.tsx's module
 * comment). That means Encerrados' size can no longer influence the
 * canvas's fitView zoom AT ALL — which is exactly what these tests prove,
 * using @xyflow/react's own `getNodesBounds`/`getViewportForBounds` to
 * compute the REAL zoom fitView would land on, not just check for
 * bounding-box overlap (the previous round's test proved insufficient: it
 * passed even while the underlying shrink-to-illegibility bug was live).
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

/** `firmCount` live firm traders + `controlCount` live control traders —
 * both realistically capped at ROSTER_SIZE = 5 by the motor, but nothing
 * here enforces that; buildGraph doesn't need to know about the cap. */
function buildLiveRoster(firmCount: number, controlCount: number): Employee[] {
  const firm = Array.from({ length: firmCount }, (_, i) =>
    makeEmployee({ traderId: `firm-${i}`, name: `Firma ${i}`, cohort: "evolved", status: "live" }),
  );
  const control = Array.from({ length: controlCount }, (_, i) =>
    makeEmployee({ traderId: `control-${i}`, name: `Controle ${i}`, cohort: "random", status: "live" }),
  );
  return [...firm, ...control];
}

/** `count` dead/fired employees (alternating cohort + dead/fired so both
 * branches of the "Encerrados" filter are exercised) — this is the row
 * that grows unbounded over a generation's life from HR rotation, the
 * original bug's exact scenario. */
function buildFallen(count: number): Employee[] {
  return Array.from({ length: count }, (_, i) =>
    makeEmployee({
      traderId: `fallen-${i}`,
      name: `Caido ${i}`,
      cohort: i % 2 === 0 ? "evolved" : "random",
      status: i % 3 === 0 ? "dead" : "fired",
    }),
  );
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

/** Representative desktop viewport for `.org-graph-panel` (theme.css: fixed
 * height 520px, no fixed width — it stretches to its container). Computes
 * the REAL zoom `fitView` would resolve to for a given employee roster,
 * via the same library functions (`getNodesBounds`/`getViewportForBounds`)
 * and the same `VIEWPORT_MIN_ZOOM`/`FIT_VIEW_OPTIONS.padding` OrgGraph.tsx
 * actually renders with — not a hand-derived approximation. */
const PANEL_WIDTH = 900;
const PANEL_HEIGHT = 520;
const FIT_VIEW_MAX_ZOOM = 2; // xyflow's own default maxZoom

function fitZoomFor(employees: Employee[]): number {
  const { nodes } = buildGraph(employees, "policy", 0, 0, NOOP_SELECT, 100_000, []);
  const bounds = getNodesBounds(nodes);
  return getViewportForBounds(bounds, PANEL_WIDTH, PANEL_HEIGHT, VIEWPORT_MIN_ZOOM, FIT_VIEW_MAX_ZOOM, FIT_VIEW_OPTIONS.padding)
    .zoom;
}

describe("buildGraph — live-tier canvas (v4.2 Task 1)", () => {
  it("computes the exact same fitView zoom for a full live roster whether Encerrados has 15 or 60 entries — Encerrados can no longer shrink the live tiers at all", () => {
    const liveRoster = buildLiveRoster(5, 5); // full ROSTER_SIZE=5 both cohorts — the widest the live canvas ever gets
    const zoomWith15Fallen = fitZoomFor([...liveRoster, ...buildFallen(15)]);
    const zoomWith60Fallen = fitZoomFor([...liveRoster, ...buildFallen(60)]);

    // The actual v4 Task B1 bug: growing Encerrados forced fitView to zoom
    // out further, shrinking every node including the live tiers. Proving
    // the zoom is IDENTICAL regardless of Encerrados' size — not just
    // "still not overlapping" — is the real regression guard here.
    expect(zoomWith60Fallen).toBe(zoomWith15Fallen);

    // And it must be a genuinely legible zoom, not merely unchanged.
    expect(zoomWith15Fallen).toBeGreaterThanOrEqual(VIEWPORT_MIN_ZOOM);
    expect(zoomWith15Fallen).toBeGreaterThanOrEqual(0.5);
  });

  it("keeps a legible fitView zoom for a typical small roster (well above the VIEWPORT_MIN_ZOOM floor)", () => {
    const zoom = fitZoomFor([...buildLiveRoster(2, 1), ...buildFallen(20)]);
    expect(zoom).toBeGreaterThanOrEqual(0.7);
  });

  it("never renders an Encerrados/fallen employee as a graph node — they render in OrgGraph's plain list instead", () => {
    const employees = [...buildLiveRoster(2, 2), ...buildFallen(15)];
    const { nodes, edges } = buildGraph(employees, "policy", 1, 1, NOOP_SELECT, 100_000, []);

    const nodeIds = new Set(nodes.map((n) => n.id));
    for (let i = 0; i < 15; i++) {
      expect(nodeIds.has(`fallen-${i}`)).toBe(false);
    }
    // No edge should reference a fallen id either, source or target.
    for (const edge of edges) {
      expect(edge.source.startsWith("fallen-")).toBe(false);
      expect(edge.target.startsWith("fallen-")).toBe(false);
    }
  });

  it("keeps zero bounding-box overlap among the (now bounded) live-tier nodes — still true, just no longer the only thing tested", () => {
    const employees = buildLiveRoster(5, 5);
    const { nodes } = buildGraph(employees, "policy", 2, 1, NOOP_SELECT, 100_000, []);

    expect(nodes.length).toBe(1 + 1 + 1 + 5 + 1 + 5); // rh-caption, rh, firm-caption+5, control-caption+5
    expect(findOverlaps(nodes.map(toRect))).toEqual([]);
  });

  it("labels every non-empty live tier with its own header caption node", () => {
    const employees = [...buildLiveRoster(2, 2), ...buildFallen(2)];
    const { nodes } = buildGraph(employees, "policy", 1, 1, NOOP_SELECT, 100_000, []);

    const captionTexts = nodes.filter((n) => n.type === "caption").map((n) => (n.data as { text: string }).text);
    expect(captionTexts).toEqual(["Recursos Humanos", "A Firma", "Controle"]);
  });

  it("omits the Controle header when that cohort has no live employees this generation", () => {
    const employees = [...buildLiveRoster(3, 0), ...buildFallen(2)];
    const { nodes } = buildGraph(employees, "policy", 1, 0, NOOP_SELECT, 100_000, []);

    const captionTexts = nodes.filter((n) => n.type === "caption").map((n) => (n.data as { text: string }).text);
    expect(captionTexts).toEqual(["Recursos Humanos", "A Firma"]);
    expect(findOverlaps(nodes.map(toRect))).toEqual([]);
  });

  it("gives the RH node its own caption above it, distinct from the row-tier headers", () => {
    const employees = buildLiveRoster(1, 1);
    const { nodes } = buildGraph(employees, "policy", 0, 0, NOOP_SELECT, 100_000, []);

    const rhCaption = nodes.find((n) => n.id === "rh-caption");
    const rhNode = nodes.find((n) => n.id === "rh");
    expect(rhCaption).toBeDefined();
    expect((rhCaption?.data as { text: string }).text).toBe("Recursos Humanos");
    expect(rhCaption?.position.y).toBeLessThan(rhNode?.position.y ?? 0);
    expect(findOverlaps([toRect(rhCaption!), toRect(rhNode!)])).toEqual([]);
  });

  it("drops the lineage edge (but never the RH edge) for a live employee whose parent has since fallen out of the graph", () => {
    const parent = makeEmployee({ traderId: "t-parent", name: "Parent", cohort: "evolved", status: "fired" });
    const child = makeEmployee({
      traderId: "t-child",
      name: "Child",
      cohort: "evolved",
      status: "live",
      parentTraderId: "t-parent",
      parentName: "Parent",
    });
    const { nodes, edges } = buildGraph([parent, child], "policy", 1, 0, NOOP_SELECT, 100_000, []);

    expect(nodes.some((n) => n.id === "t-parent")).toBe(false); // parent is fallen — plain-list territory now
    expect(nodes.some((n) => n.id === "t-child")).toBe(true);
    expect(edges.some((e) => e.id.startsWith("lineage-"))).toBe(false);
    expect(edges.some((e) => e.id === "rh-t-child")).toBe(true); // the child itself still gets its RH edge
  });
});

describe("OrgGraph — Encerrados as a plain scrollable list (v4.2 Task 1)", () => {
  it("renders 20 Encerrados entries as plain list cards, entirely outside the xyflow canvas, all at once", () => {
    const employees = [...buildLiveRoster(2, 2), ...buildFallen(20)];
    render(
      <OrgGraph employees={employees} hrPolicy="policy" leaderboard={[]} demissoes={0} promocoes={0} stakeMc={100_000} />,
    );

    const fallenItems = document.querySelectorAll(".org-fallen-item");
    expect(fallenItems.length).toBe(20);

    // Genuinely outside the fitView-affected canvas, not just visually
    // below it — the whole point of the fix.
    const panel = document.querySelector(".org-graph-panel");
    expect(panel?.querySelector(".org-fallen-item")).toBeNull();

    // The independently-scrollable container itself is present (max-height
    // + overflow-y: auto, theme.css's `.org-fallen-list`) — jsdom doesn't
    // run real CSS layout, so this asserts the structural contract, not a
    // measured scrollbar (same limitation setupTests.ts already documents
    // for this library elsewhere in the suite).
    expect(document.querySelector(".org-fallen-list")).toBeInTheDocument();
  });

  it("renders no Encerrados panel at all when nobody has left the firm yet", () => {
    render(
      <OrgGraph
        employees={buildLiveRoster(2, 2)}
        hrPolicy="policy"
        leaderboard={[]}
        demissoes={0}
        promocoes={0}
        stakeMc={100_000}
      />,
    );

    expect(document.querySelector(".org-fallen-panel")).toBeNull();
  });

  it("still opens the profile drawer when an Encerrados card is clicked", () => {
    const employees = [...buildLiveRoster(1, 0), ...buildFallen(1)];
    render(
      <OrgGraph employees={employees} hrPolicy="policy" leaderboard={[]} demissoes={0} promocoes={0} stakeMc={100_000} />,
    );

    const card = document.querySelector(".org-fallen-item .org-node");
    expect(card).not.toBeNull();
    fireEvent.click(card!);

    expect(document.querySelector(".empresa-drawer-name")?.textContent).toBe("Caido 0");
  });
});
