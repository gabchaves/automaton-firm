import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  ReactFlow,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { PalcoSnapshot } from "../types";
import { usd, hoursUntilNextUtcMidnight } from "../format";
import { initials, avatarBackground } from "../avatar";
import { moodEmoji } from "../mood";
import { lineageLine, type Employee } from "../lineage";
import { cargoForEmployee } from "../cargo";
import { EmpresaDrawer } from "./EmpresaDrawer";

type LeaderboardEntry = PalcoSnapshot["leaderboard"][number];

interface OrgGraphProps {
  employees: Employee[];
  hrPolicy: string;
  leaderboard: LeaderboardEntry[];
  demissoes: number;
  promocoes: number;
  stakeMc: number; // snapshot.cards.traderStartMc (or its fallback) — see mood.ts
}

const STATUS_PT: Record<string, string> = { live: "vivo", dead: "morto", fired: "demitido" };
const STATUS_CLASS: Record<string, string> = { live: "status-live", dead: "status-dead", fired: "status-fired" };

/** "↳ ..." tooltip text for an employee's node — see `lineageLine` (shared
 * with the Empresa profile drawer, v3.1 plan) for the branch logic itself. */
function lineageTitle(employee: Employee): string | undefined {
  const line = lineageLine(employee);
  return line ? `↳ ${line}` : undefined;
}

// ---------- Layout ----------
// v4 plan (Task B1) rewrite: the v3.1 layout used a handful of hand-tuned
// fixed Y coordinates for exactly 3 rows. That broke down for the
// "Encerrados" (dead/fired) row, which is fed continuously by HR rotation
// over the life of a generation and has no upper bound. B1's fix (re-run
// fitView on roster change + a very low minZoom floor) made every node
// technically non-overlapping, but it didn't actually solve the complaint:
// fitting an ever-growing Encerrados row into one viewport forces fitView to
// zoom out further and further, so EVERY node — including the small, bounded
// live tiers — keeps shrinking toward illegibility. Nothing overlaps, but it
// still reads as "amontoado" (crowded) because you can no longer read it.
//
// v4.2 Task 1's actual fix: stop putting Encerrados in the fitView-affected
// canvas at all. Only RH + the two LIVE tiers (A Firma, Controle) are xyflow
// nodes now — each cohort is capped at ROSTER_SIZE = 5 live traders
// (src/motor/cohort.ts), so this graph's content is always small and
// bounded, and fitView never has to zoom out to accommodate unbounded growth
// again (see `buildGraph` below). "Encerrados" (dead/fired, either cohort)
// renders as a plain, independently-scrollable HTML card list BELOW the
// graph instead (see the `OrgGraph` component) — no xyflow, no fitView, no
// shared zoom budget with the live tiers, so it can grow forever without
// ever shrinking anything else. It reuses the exact same `.org-node` card
// markup (via the shared `EmployeeCard` below) at a fixed, legible size.
const RH_WIDTH = 220;
const RH_HEIGHT = 116;
const NODE_WIDTH = 176;
const NODE_HEIGHT = 92;
const ROW_GAP_X = 32; // v4.2: widened from 24 for more breathing room between nodes
const ROW_STEP_X = NODE_WIDTH + ROW_GAP_X;
const CAPTION_HEIGHT = 24;
const MIN_CAPTION_WIDTH = 220;
// v4.2: raised from 0.1. That floor existed only to let fitView zoom out far
// enough for an unbounded Encerrados row — now that Encerrados isn't part of
// this graph, content is always small (RH + up to 5+5 live traders), so a
// much higher floor is safe and guarantees nodes never render smaller than a
// legible ~55% scale, matching the plan's "minZoom raised" direction.
// Exported so OrgGraph.test.tsx's fitView-zoom regression test asserts
// against the SAME floor this component actually renders with, not a
// hand-copied duplicate of the number.
export const VIEWPORT_MIN_ZOOM = 0.55;

// Vertical stack, top to bottom: RH's own "Recursos Humanos" tier, then one
// tier per live row with a clear section header ("A Firma" / "Controle")
// above it — spatial grouping alone doesn't count per the plan, every tier
// needs its own labeled header. Gaps widened in v4.2 for general breathing
// room (the "amontoado" complaint) and so RH reads as clearly separate from
// the trader tiers below it.
const RH_CAPTION_Y = 0;
const RH_CAPTION_TO_NODE_GAP = 14; // v4.2: widened from 10
const RH_NODE_Y = RH_CAPTION_Y + CAPTION_HEIGHT + RH_CAPTION_TO_NODE_GAP;
const SECTION_GAP = 72; // v4.2: widened from 56 — space between one tier's end and the next header
const HEADER_TO_ROW_GAP = 18; // v4.2: widened from 14

const FIRM_HEADER_Y = RH_NODE_Y + RH_HEIGHT + SECTION_GAP;
const FIRM_ROW_Y = FIRM_HEADER_Y + CAPTION_HEIGHT + HEADER_TO_ROW_GAP;
const CONTROL_HEADER_Y = FIRM_ROW_Y + NODE_HEIGHT + SECTION_GAP;
const CONTROL_ROW_Y = CONTROL_HEADER_Y + CAPTION_HEIGHT + HEADER_TO_ROW_GAP;

interface EmployeeCardData {
  employee: Employee;
  tooltip?: string;
  onSelect: (traderId: string) => void;
  stakeMc: number;
  cargoTitulo: string; // cargo.ts's titulo — short job-title line under the name
}

type EmployeeNodeData = EmployeeCardData & Record<string, unknown>;

interface RhNodeData extends Record<string, unknown> {
  hrPolicy: string;
  demissoes: number;
  promocoes: number;
}

interface CaptionNodeData extends Record<string, unknown> {
  text: string;
}

type EmployeeFlowNode = Node<EmployeeNodeData, "employee">;
type RhFlowNode = Node<RhNodeData, "rh">;
type CaptionFlowNode = Node<CaptionNodeData, "caption">;
type OrgFlowNode = EmployeeFlowNode | RhFlowNode | CaptionFlowNode;

/** Compact employee card: square avatar, name + mood emoji, book (mono),
 * status chip. Dead/fired nodes render at 55% opacity via `.org-node-dim`.
 * Clickable (v3.1 plan) — opens the profile drawer for this trader.
 *
 * v4.2 Task 1: extracted from `EmployeeNodeView` so the exact same
 * card markup/classes (`.org-node`, `.org-node-name`, `.org-node-cargo`, …)
 * render for BOTH the live-tier xyflow nodes below AND the plain
 * "Encerrados" list (see the `OrgGraph` component) — the two render paths
 * differ only in whether xyflow `<Handle>`s wrap around this, which is why
 * this component itself has none. Existing DOM queries that scope through
 * `.org-node`/`.org-node-name` (e.g. EmpresaTab.test.tsx's
 * `orgNodeByEmployeeName`) work identically either way. */
function EmployeeCard({ employee, tooltip, onSelect, stakeMc, cargoTitulo }: EmployeeCardData) {
  const dim = employee.status !== "live";

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(employee.traderId);
    }
  }

  return (
    <div
      className={`org-node${dim ? " org-node-dim" : ""}`}
      title={tooltip}
      role="button"
      tabIndex={0}
      aria-label={`Ver perfil de ${employee.name}`}
      onClick={() => onSelect(employee.traderId)}
      onKeyDown={handleKeyDown}
    >
      <div className="org-node-avatar" style={{ background: avatarBackground(employee.name) }}>
        {initials(employee.name)}
      </div>
      <div className="org-node-body">
        <div className="org-node-name">
          {employee.name}
          <span className="mood-emoji">{moodEmoji(employee.status, employee.bookMc, stakeMc)}</span>
        </div>
        <div className="org-node-cargo">{cargoTitulo}</div>
        <div className="org-node-book">{usd(employee.bookMc)}</div>
        <span className={`status-chip ${STATUS_CLASS[employee.status] ?? ""}`}>
          {STATUS_PT[employee.status] ?? employee.status}
        </span>
      </div>
    </div>
  );
}

/** xyflow node wrapper around `EmployeeCard` for the live tiers — adds the
 * (invisible, read-only-diagram) target/source handles edges anchor to.
 * `role="button"` + keyboard handling live in `EmployeeCard` itself, shared
 * with the plain Encerrados list below. */
function EmployeeNodeView({ data }: NodeProps<EmployeeFlowNode>) {
  const { employee, tooltip, onSelect, stakeMc, cargoTitulo } = data;
  return (
    <>
      <Handle type="target" position={Position.Top} className="org-node-handle" />
      <EmployeeCard employee={employee} tooltip={tooltip} onSelect={onSelect} stakeMc={stakeMc} cargoTitulo={cargoTitulo} />
      <Handle type="source" position={Position.Bottom} className="org-node-handle" />
    </>
  );
}

/** RH's anchor node — top-center, `hrPolicy` in a title tooltip (same
 * pattern as before). v3.1 added the cycle's demissões/promoções counters
 * and a live "próxima avaliação" countdown to the next 00:00 UTC, computed
 * fresh on every render (plain Date math, no interval — see
 * `hoursUntilNextUtcMidnight`). v4 (Task B1) makes RH visually unmistakable:
 * its own accent icon, a top accent bar (`.org-rh-node`'s `--blue` border,
 * theme.css), and a "Recursos Humanos" caption node above it (built in
 * `buildGraph`) instead of relying on spatial position alone. No target
 * handle: RH only ever originates edges, never receives one. */
function RhNodeView({ data }: NodeProps<RhFlowNode>) {
  const { hours, minutes } = hoursUntilNextUtcMidnight(Date.now());
  return (
    <div className="org-rh-node" title={data.hrPolicy}>
      <span className="org-rh-icon" aria-hidden="true">
        🗂️
      </span>
      <span className="org-rh-title">RH</span>
      <div className="org-rh-counters">
        <span>{data.demissoes} demissões</span>
        <span>{data.promocoes} promoções</span>
      </div>
      <div className="org-rh-next">
        próxima avaliação em {hours}h{String(minutes).padStart(2, "0")}
      </div>
      <Handle type="source" position={Position.Bottom} className="org-node-handle" />
    </div>
  );
}

/** Small mono caption labeling a tier — "Recursos Humanos" above RH, "A
 * Firma" / "Controle" above their rows (v4 plan: explicit text headers, not
 * just spatial grouping). Plain text node, no handles, never a lineage/RH
 * edge endpoint. */
function CaptionNodeView({ data }: NodeProps<CaptionFlowNode>) {
  return <div className="org-caption-node">{data.text}</div>;
}

const NODE_TYPES: NodeTypes = { employee: EmployeeNodeView, rh: RhNodeView, caption: CaptionNodeView };

/** Resolves the shared per-employee card fields (cargo title + lineage
 * tooltip) by joining against `leaderboard` — used by both `rowNodes` (the
 * live-tier xyflow nodes) and the OrgGraph component's plain Encerrados
 * list, so this join logic isn't duplicated between the two render paths. A
 * generation seed with no live leaderboard row just yields families: []
 * (cargoForEmployee degrades gracefully, no crash). */
function cardData(employee: Employee, leaderboard: LeaderboardEntry[]): { tooltip?: string; cargoTitulo: string } {
  const leaderboardEntry = leaderboard.find((entry) => entry.traderId === employee.traderId) ?? null;
  return { tooltip: lineageTitle(employee), cargoTitulo: cargoForEmployee(employee, leaderboardEntry).titulo };
}

/** Lays out one horizontal row of LIVE employee nodes, centered on x=0,
 * spaced by a constant `ROW_STEP_X`. Both live tiers are capped at
 * ROSTER_SIZE = 5 (src/motor/cohort.ts), so this row's width is always
 * bounded — unlike the pre-v4.2 "Encerrados" row this replaced, there is no
 * unbounded-growth case to worry about here at all. */
function rowNodes(
  list: Employee[],
  y: number,
  onSelect: (traderId: string) => void,
  stakeMc: number,
  leaderboard: LeaderboardEntry[],
): EmployeeFlowNode[] {
  const n = list.length;
  return list.map((employee, index) => {
    const { tooltip, cargoTitulo } = cardData(employee, leaderboard);
    return {
      id: employee.traderId,
      type: "employee",
      position: { x: (index - (n - 1) / 2) * ROW_STEP_X, y },
      measured: { width: NODE_WIDTH, height: NODE_HEIGHT },
      handles: [
        { type: "target", position: Position.Top, x: NODE_WIDTH / 2, y: 0 },
        { type: "source", position: Position.Bottom, x: NODE_WIDTH / 2, y: NODE_HEIGHT },
      ],
      data: { employee, tooltip, onSelect, stakeMc, cargoTitulo },
      draggable: false,
      selectable: false,
    };
  });
}

/** One tier: a labeled header caption plus its row, both centered on x=0
 * and sized from the row's own width — so the header always spans exactly
 * as wide as the row it labels. Returns `[]` when `list` is empty. */
function sectionNodes(
  list: Employee[],
  headerY: number,
  rowY: number,
  headerText: string,
  headerId: string,
  onSelect: (traderId: string) => void,
  stakeMc: number,
  leaderboard: LeaderboardEntry[],
): OrgFlowNode[] {
  if (list.length === 0) return [];
  const rowWidth = Math.max(list.length * ROW_STEP_X - ROW_GAP_X, MIN_CAPTION_WIDTH);
  const header: CaptionFlowNode = {
    id: headerId,
    type: "caption",
    position: { x: -rowWidth / 2, y: headerY },
    measured: { width: rowWidth, height: CAPTION_HEIGHT },
    data: { text: headerText },
    draggable: false,
    selectable: false,
  };
  return [header, ...rowNodes(list, rowY, onSelect, stakeMc, leaderboard)];
}

/**
 * Builds the xyflow graph for the LIVE tiers only — RH, "A Firma" (live firm
 * traders), "Controle" (live control traders). v4.2 Task 1: "Encerrados"
 * (anyone dead/fired, either cohort) is no longer part of this graph at all
 * — see the module comment above `RH_WIDTH` for why, and the `OrgGraph`
 * component for where it renders instead. Because both live tiers are
 * capped at ROSTER_SIZE = 5, this graph's content is always small and
 * bounded, which is what lets fitView keep a legible zoom regardless of how
 * large Encerrados grows over a generation's life.
 */
export function buildGraph(
  employees: Employee[],
  hrPolicy: string,
  demissoes: number,
  promocoes: number,
  onSelect: (traderId: string) => void,
  stakeMc: number,
  leaderboard: LeaderboardEntry[],
): { nodes: OrgFlowNode[]; edges: Edge[] } {
  const firmLive = employees.filter((e) => e.cohort === "evolved" && e.status === "live");
  const controlLive = employees.filter((e) => e.cohort === "random" && e.status === "live");
  // Only firmLive traders are graph nodes now, so an RH/lineage edge may
  // only target one of them — same "skip a link to a node that isn't on
  // this graph" precedent the lineage edge already used pre-v4.2 (a
  // parentTraderId belonging to an ended generation had no matching node
  // either). A live employee whose parent has since fallen (moved to the
  // plain Encerrados list) just loses the animated edge, not the tooltip —
  // `lineageTitle` still names the parent regardless.
  const firmLiveIds = new Set(firmLive.map((e) => e.traderId));

  const rhCaption: CaptionFlowNode = {
    id: "rh-caption",
    type: "caption",
    position: { x: -RH_WIDTH / 2, y: RH_CAPTION_Y },
    measured: { width: RH_WIDTH, height: CAPTION_HEIGHT },
    data: { text: "Recursos Humanos" },
    draggable: false,
    selectable: false,
  };

  const rhNode: RhFlowNode = {
    id: "rh",
    type: "rh",
    position: { x: -RH_WIDTH / 2, y: RH_NODE_Y },
    measured: { width: RH_WIDTH, height: RH_HEIGHT },
    // Explicit handle bounds (source, bottom-center), same reasoning as
    // `measured` above: this is how xyflow computes edge anchor points
    // without a live ResizeObserver measurement, which jsdom can't provide.
    handles: [{ type: "source", position: Position.Bottom, x: RH_WIDTH / 2, y: RH_HEIGHT }],
    data: { hrPolicy, demissoes, promocoes },
    draggable: false,
    selectable: false,
  };

  const nodes: OrgFlowNode[] = [
    rhCaption,
    rhNode,
    ...sectionNodes(firmLive, FIRM_HEADER_Y, FIRM_ROW_Y, "A Firma", "firm-caption", onSelect, stakeMc, leaderboard),
    ...sectionNodes(
      controlLive,
      CONTROL_HEADER_Y,
      CONTROL_ROW_Y,
      "Controle",
      "control-caption",
      onSelect,
      stakeMc,
      leaderboard,
    ),
  ];

  const edges: Edge[] = [];
  for (const employee of firmLive) {
    // RH -> every LIVE firm trader. Control traders are the random
    // baseline, not an HR-managed cohort, so they never get this edge.
    edges.push({
      id: `rh-${employee.traderId}`,
      source: "rh",
      target: employee.traderId,
      style: { stroke: "hsla(0, 0%, 100%, 0.3)", strokeWidth: 1 },
      selectable: false,
      focusable: false,
    });

    if (employee.parentTraderId !== null && firmLiveIds.has(employee.parentTraderId)) {
      edges.push({
        id: `lineage-${employee.parentTraderId}-${employee.traderId}`,
        source: employee.parentTraderId,
        target: employee.traderId,
        animated: true,
        label: "mutação",
        style: { stroke: "#0f0", strokeWidth: 1.5 },
        labelStyle: { fill: "#0f0", fontFamily: "'Geist Mono', Consolas, monospace", fontSize: 10 },
        labelBgStyle: { fill: "#111" },
        selectable: false,
        focusable: false,
      });
    }
  }

  return { nodes, edges };
}

// Exported alongside VIEWPORT_MIN_ZOOM for the same reason — the test
// computes the real fitView zoom via @xyflow/react's own
// getViewportForBounds/getNodesBounds and needs the identical padding.
export const FIT_VIEW_OPTIONS = { padding: 0.3 };

/**
 * Empresa's org chart (v3 plan Task 3; restructured in v3.1/v4; v4.2 Task 1
 * splits it into two independent surfaces to fix real crowding, not just
 * overlap — see the module comment above `RH_WIDTH`):
 *
 * 1. An xyflow canvas (`.org-graph-panel`) with ONLY the live tiers: RH
 *    anchors top-center under its own "Recursos Humanos" caption; below it,
 *    "A Firma" (live firm traders) then "Controle" (live control traders).
 *    RH connects to every live firm trader with a faint hairline, and a
 *    parentTraderId mutation lineage draws its own animated green edge
 *    labeled "mutação". Both tiers are capped at ROSTER_SIZE = 5, so this
 *    canvas is always small and fitView always lands at a legible zoom —
 *    re-run whenever the live roster's shape changes (`nodes.length`), not
 *    just on mount. Pan/zoom + fitView are the only interaction; dragging
 *    and selection stay disabled, EXCEPT clicking an employee node, which
 *    opens that trader's profile drawer.
 * 2. A plain, independently-scrollable HTML card list (`.org-fallen-panel`)
 *    for "Encerrados" (anyone dead/fired, either cohort) — no xyflow, no
 *    shared zoom budget with the canvas above, so it can grow without bound
 *    over a generation's life without ever shrinking the live tiers. Reuses
 *    the exact same `.org-node` card (via `EmployeeCard`) at a fixed size,
 *    and is still clickable to open the profile drawer.
 *
 * No <Background> component on the canvas: the page's own static grain
 * overlay (theme.css's `.page::after`) shows through the panel instead.
 */
export function OrgGraph({ employees, hrPolicy, leaderboard, demissoes, promocoes, stakeMc }: OrgGraphProps) {
  const [selectedTraderId, setSelectedTraderId] = useState<string | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance<OrgFlowNode, Edge> | null>(null);

  const { nodes, edges } = useMemo(
    () => buildGraph(employees, hrPolicy, demissoes, promocoes, setSelectedTraderId, stakeMc, leaderboard),
    [employees, hrPolicy, demissoes, promocoes, stakeMc, leaderboard],
  );

  // "Encerrados" — dead/fired, either cohort — the plain scrollable list
  // below the canvas, entirely outside buildGraph/xyflow (see the module
  // comment above `RH_WIDTH`).
  const fallen = useMemo(() => employees.filter((e) => e.status !== "live"), [employees]);

  // The `fitView` prop only fits once, when the store first initializes —
  // it does NOT re-run just because `nodes` changes later. Re-running it
  // explicitly whenever the LIVE graph's own shape changes (`nodes.length`)
  // keeps the canvas properly framed as traders are hired/fired — this no
  // longer needs to react to Encerrados growth at all, since Encerrados
  // isn't part of `nodes` anymore.
  useEffect(() => {
    rfInstance?.fitView(FIT_VIEW_OPTIONS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfInstance, nodes.length]);

  const selectedEmployee = selectedTraderId
    ? (employees.find((e) => e.traderId === selectedTraderId) ?? null)
    : null;
  const selectedLeaderboardEntry = selectedTraderId
    ? (leaderboard.find((l) => l.traderId === selectedTraderId) ?? null)
    : null;

  return (
    <>
      <div className="org-graph-panel">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={() => {}}
          onEdgesChange={() => {}}
          onInit={setRfInstance}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={VIEWPORT_MIN_ZOOM}
        >
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {fallen.length > 0 && (
        <div className="org-fallen-panel">
          <div className="org-fallen-header">Encerrados</div>
          <ul className="org-fallen-list">
            {fallen.map((employee) => {
              const { tooltip, cargoTitulo } = cardData(employee, leaderboard);
              return (
                <li key={employee.traderId} className="org-fallen-item">
                  <EmployeeCard
                    employee={employee}
                    tooltip={tooltip}
                    onSelect={setSelectedTraderId}
                    stakeMc={stakeMc}
                    cargoTitulo={cargoTitulo}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <EmpresaDrawer
        employee={selectedEmployee}
        leaderboardEntry={selectedLeaderboardEntry}
        onClose={() => setSelectedTraderId(null)}
        stakeMc={stakeMc}
      />
    </>
  );
}
