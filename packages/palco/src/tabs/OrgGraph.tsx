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
// over the life of a generation and has no upper bound — a wide-enough row
// combined with a viewport that only ever fit ONCE, on mount, meant new
// nodes could render outside the last-fit pan/zoom bounds: not overlapping
// each other (rowNodes already spaces every row by a fixed per-node step
// with no max-per-row cap — see below), but effectively clipped from view.
//
// The actual fix has two independent parts:
//  1. `fitView` must re-run whenever the employee roster's shape changes,
//     not just once on mount (see the `useEffect` in `OrgGraph` below,
//     keyed on `employees.length`).
//  2. The viewport's `minZoom` must be low enough that fitView can always
//     zoom out far enough to show an arbitrarily wide row instead of
//     clamping and cropping it (see `VIEWPORT_MIN_ZOOM` below).
// Every row (live firm, live control, encerrados) is still laid out by
// `rowNodes`: nodes are centered on x=0 and spaced by a constant
// `ROW_STEP_X`, so a row of ANY length never overlaps itself — there is no
// per-row node-count cap to remove, it never existed in the spacing math.
// What full-page horizontal scroll can't do here (this is a canvas, not a
// document — react-flow lays nodes out via transforms, not normal block
// flow, so growing `.org-graph-panel`'s CSS width wouldn't reveal more of
// it) the combination above does instead: pan/zoom (via <Controls>, per
// the plan's "pan/zoom do grafo continua") always reaches every node.
const RH_WIDTH = 220;
const RH_HEIGHT = 116;
const NODE_WIDTH = 176;
const NODE_HEIGHT = 92;
const ROW_STEP_X = NODE_WIDTH + 24;
const CAPTION_HEIGHT = 24;
const MIN_CAPTION_WIDTH = 220;
const VIEWPORT_MIN_ZOOM = 0.1; // generous floor — see the note above

// Vertical stack, top to bottom: RH's own "Recursos Humanos" tier, then one
// tier per row with a clear section header ("A Firma" / "Controle" /
// "Encerrados") above it — spatial grouping alone doesn't count per the
// plan, every tier needs its own labeled header.
const RH_CAPTION_Y = 0;
const RH_CAPTION_TO_NODE_GAP = 10;
const RH_NODE_Y = RH_CAPTION_Y + CAPTION_HEIGHT + RH_CAPTION_TO_NODE_GAP;
const SECTION_GAP = 56; // space between the end of one tier and the next header
const HEADER_TO_ROW_GAP = 14;

const FIRM_HEADER_Y = RH_NODE_Y + RH_HEIGHT + SECTION_GAP;
const FIRM_ROW_Y = FIRM_HEADER_Y + CAPTION_HEIGHT + HEADER_TO_ROW_GAP;
const CONTROL_HEADER_Y = FIRM_ROW_Y + NODE_HEIGHT + SECTION_GAP;
const CONTROL_ROW_Y = CONTROL_HEADER_Y + CAPTION_HEIGHT + HEADER_TO_ROW_GAP;
const FALLEN_HEADER_Y = CONTROL_ROW_Y + NODE_HEIGHT + SECTION_GAP;
const FALLEN_ROW_Y = FALLEN_HEADER_Y + CAPTION_HEIGHT + HEADER_TO_ROW_GAP;

interface EmployeeNodeData extends Record<string, unknown> {
  employee: Employee;
  tooltip?: string;
  onSelect: (traderId: string) => void;
  stakeMc: number;
  cargoTitulo: string; // cargo.ts's titulo — short job-title line under the name
}

interface RhNodeData extends Record<string, unknown> {
  hrPolicy: string;
  demissoes: number;
  promocoes: number;
}

interface CaptionNodeData extends Record<string, unknown> {
  text: string;
  dim?: boolean;
}

type EmployeeFlowNode = Node<EmployeeNodeData, "employee">;
type RhFlowNode = Node<RhNodeData, "rh">;
type CaptionFlowNode = Node<CaptionNodeData, "caption">;
type OrgFlowNode = EmployeeFlowNode | RhFlowNode | CaptionFlowNode;

/** Compact employee card: square avatar, name + mood emoji, book (mono),
 * status chip. Dead/fired nodes render at 55% opacity via `.org-node-dim`.
 * Clickable (v3.1 plan) — opens the profile drawer for this trader; a
 * plain onClick is enough since `selectable`/`nodesDraggable` stay false
 * (this is a read-only diagram), but the node still needs its own
 * keyboard affordance since xyflow doesn't make custom nodes focusable. */
function EmployeeNodeView({ data }: NodeProps<EmployeeFlowNode>) {
  const { employee, tooltip, onSelect, stakeMc, cargoTitulo } = data;
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
      <Handle type="target" position={Position.Top} className="org-node-handle" />
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
      <Handle type="source" position={Position.Bottom} className="org-node-handle" />
    </div>
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
 * Firma" / "Controle" / "Encerrados" above their rows (v4 plan: explicit
 * text headers, not just spatial grouping). `dim` mutes the Encerrados
 * header to match its row's own 55%-opacity treatment. Plain text node, no
 * handles, never a lineage/RH edge endpoint. */
function CaptionNodeView({ data }: NodeProps<CaptionFlowNode>) {
  return <div className={`org-caption-node${data.dim ? " org-caption-node-dim" : ""}`}>{data.text}</div>;
}

const NODE_TYPES: NodeTypes = { employee: EmployeeNodeView, rh: RhNodeView, caption: CaptionNodeView };

/** Lays out one horizontal row of employee nodes, centered on x=0, spaced
 * by a constant `ROW_STEP_X` — no per-row node-count cap, so a row of any
 * length (the "Encerrados" row grows unbounded over a generation's life
 * from HR rotation) never overlaps itself; see the module-level comment
 * for how the viewport (not this spacing math) is what used to clip it.
 * Each node's cargo.titulo (see cargo.ts) is derived here by joining the
 * employee against `leaderboard` by traderId — same join pattern the
 * profile drawer already uses for the genome section; a generation seed
 * with no live leaderboard row just yields families: [] (cargoForEmployee
 * degrades gracefully, no crash). */
function rowNodes(
  list: Employee[],
  y: number,
  onSelect: (traderId: string) => void,
  stakeMc: number,
  leaderboard: LeaderboardEntry[],
): EmployeeFlowNode[] {
  const n = list.length;
  return list.map((employee, index) => {
    const leaderboardEntry = leaderboard.find((entry) => entry.traderId === employee.traderId) ?? null;
    const cargoTitulo = cargoForEmployee(employee, leaderboardEntry).titulo;
    return {
      id: employee.traderId,
      type: "employee",
      position: { x: (index - (n - 1) / 2) * ROW_STEP_X, y },
      measured: { width: NODE_WIDTH, height: NODE_HEIGHT },
      handles: [
        { type: "target", position: Position.Top, x: NODE_WIDTH / 2, y: 0 },
        { type: "source", position: Position.Bottom, x: NODE_WIDTH / 2, y: NODE_HEIGHT },
      ],
      data: { employee, tooltip: lineageTitle(employee), onSelect, stakeMc, cargoTitulo },
      draggable: false,
      selectable: false,
    };
  });
}

/** One tier: a labeled header caption plus its row, both centered on x=0
 * and sized from the row's own (uncapped) width — so the header always
 * spans exactly as wide as the row it labels, at any row length. Returns
 * `[]` when `list` is empty: an empty tier renders no header either, same
 * precedent the v3.1 "galeria dos caídos" row already set (it only ever
 * appeared when there was at least one dead/fired employee). */
function sectionNodes(
  list: Employee[],
  headerY: number,
  rowY: number,
  headerText: string,
  headerId: string,
  onSelect: (traderId: string) => void,
  stakeMc: number,
  leaderboard: LeaderboardEntry[],
  dim = false,
): OrgFlowNode[] {
  if (list.length === 0) return [];
  const rowWidth = Math.max(list.length * ROW_STEP_X - 24, MIN_CAPTION_WIDTH);
  const header: CaptionFlowNode = {
    id: headerId,
    type: "caption",
    position: { x: -rowWidth / 2, y: headerY },
    measured: { width: rowWidth, height: CAPTION_HEIGHT },
    data: { text: headerText, dim },
    draggable: false,
    selectable: false,
  };
  return [header, ...rowNodes(list, rowY, onSelect, stakeMc, leaderboard)];
}

export function buildGraph(
  employees: Employee[],
  hrPolicy: string,
  demissoes: number,
  promocoes: number,
  onSelect: (traderId: string) => void,
  stakeMc: number,
  leaderboard: LeaderboardEntry[],
): { nodes: OrgFlowNode[]; edges: Edge[] } {
  const firmAll = employees.filter((e) => e.cohort === "evolved"); // RH edges + lineage sources span every status
  const firmLive = firmAll.filter((e) => e.status === "live");
  const controlLive = employees.filter((e) => e.cohort === "random" && e.status === "live");
  const fallen = employees.filter((e) => e.status !== "live"); // dead/fired, either cohort — v4 "Encerrados"
  const employeeIds = new Set(employees.map((e) => e.traderId));

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
    ...sectionNodes(
      fallen,
      FALLEN_HEADER_Y,
      FALLEN_ROW_Y,
      "Encerrados",
      "fallen-caption",
      onSelect,
      stakeMc,
      leaderboard,
      true,
    ),
  ];

  const edges: Edge[] = [];
  for (const employee of firmAll) {
    // RH -> every firm trader (live or fallen), per the plan's "RH → every
    // firm trader". Control traders are the random baseline, not an
    // HR-managed cohort, so they never get this edge.
    edges.push({
      id: `rh-${employee.traderId}`,
      source: "rh",
      target: employee.traderId,
      style: { stroke: "hsla(0, 0%, 100%, 0.3)", strokeWidth: 1 },
      selectable: false,
      focusable: false,
    });

    // Lineage edge only when the parent is itself a node on this graph — a
    // parentTraderId from an earlier, already-ended generation has no
    // matching node here (org.employees only lists the CURRENT
    // generation's traders, per types.ts). That case isn't silently lost:
    // the employee's tooltip (lineageTitle) still names the parent, this
    // only skips drawing an edge to a node that doesn't exist.
    if (employee.parentTraderId !== null && employeeIds.has(employee.parentTraderId)) {
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

const FIT_VIEW_OPTIONS = { padding: 0.3 };

/**
 * Empresa's org chart as an interactive lineage graph (v3 plan Task 3;
 * restructured into rows + click-to-open profile drawer in v3.1; tiered
 * headers + unmistakable RH + re-fitting viewport in v4 Task B1). RH
 * anchors top-center under its own "Recursos Humanos" caption; below it,
 * three labeled tiers: "A Firma" (live firm traders), "Controle" (live
 * control traders), and (when any exist) "Encerrados" (anyone dead/fired,
 * either cohort). RH connects to every firm trader with a faint hairline,
 * and a parentTraderId mutation lineage draws its own animated green edge
 * labeled "mutação". Pan/zoom + fitView — re-run whenever `employees.length`
 * changes, not just on mount, so a row that grows over a generation's life
 * (the "Encerrados" row, fed by HR rotation) never renders outside the
 * fitted viewport — are the only interaction; dragging and selection are
 * disabled, this is a read-only visualization, not an editor, EXCEPT
 * clicking an employee node, which opens that trader's profile drawer. No
 * <Background> component: the page's own static grain overlay (theme.css's
 * `.page::after`) shows through the panel instead.
 */
export function OrgGraph({ employees, hrPolicy, leaderboard, demissoes, promocoes, stakeMc }: OrgGraphProps) {
  const [selectedTraderId, setSelectedTraderId] = useState<string | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance<OrgFlowNode, Edge> | null>(null);

  const { nodes, edges } = useMemo(
    () => buildGraph(employees, hrPolicy, demissoes, promocoes, setSelectedTraderId, stakeMc, leaderboard),
    [employees, hrPolicy, demissoes, promocoes, stakeMc, leaderboard],
  );

  // The `fitView` prop only fits once, when the store first initializes —
  // it does NOT re-run just because `nodes` changes later. Re-running it
  // explicitly whenever the roster's shape changes is the other half of
  // this file's clipping fix (see the module-level comment above
  // `RH_WIDTH`): without this, an "Encerrados" row that grows over time
  // from HR rotation would keep rendering against the FIRST fit's bounds.
  useEffect(() => {
    rfInstance?.fitView(FIT_VIEW_OPTIONS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfInstance, employees.length]);

  const selectedEmployee = selectedTraderId
    ? (employees.find((e) => e.traderId === selectedTraderId) ?? null)
    : null;
  const selectedLeaderboardEntry = selectedTraderId
    ? (leaderboard.find((l) => l.traderId === selectedTraderId) ?? null)
    : null;

  return (
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

      <EmpresaDrawer
        employee={selectedEmployee}
        leaderboardEntry={selectedLeaderboardEntry}
        onClose={() => setSelectedTraderId(null)}
        stakeMc={stakeMc}
      />
    </div>
  );
}
