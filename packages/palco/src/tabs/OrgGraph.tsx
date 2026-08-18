import { useMemo, useState, type KeyboardEvent } from "react";
import { ReactFlow, Controls, Handle, Position, type Node, type Edge, type NodeProps, type NodeTypes } from "@xyflow/react";
import type { PalcoSnapshot } from "../types";
import { usd, hoursUntilNextUtcMidnight } from "../format";
import { initials, avatarBackground } from "../avatar";
import { moodEmoji } from "../mood";
import { lineageLine, type Employee } from "../lineage";
import { EmpresaDrawer } from "./EmpresaDrawer";

type LeaderboardEntry = PalcoSnapshot["leaderboard"][number];

interface OrgGraphProps {
  employees: Employee[];
  hrPolicy: string;
  leaderboard: LeaderboardEntry[];
  demissoes: number;
  promocoes: number;
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
// Fixed, hand-tuned coordinates — no auto-layout dependency (dagre/elk are
// not part of this dep budget). v3.1 restructure (was two vertical
// columns): RH anchors top-center; below it, three horizontal ROWS —
// live firm traders, live control traders, then a "galeria dos caídos"
// caption + row for anyone dead/fired (either cohort). `fitView` (see
// <ReactFlow> below) pans/scales the viewport to whatever this produces.
const RH_WIDTH = 210;
const RH_HEIGHT = 108;
const NODE_WIDTH = 176;
const NODE_HEIGHT = 92;
const ROW_STEP_X = NODE_WIDTH + 24;
const FIRM_ROW_Y = 190;
const CONTROL_ROW_Y = FIRM_ROW_Y + NODE_HEIGHT + 64;
const CAPTION_HEIGHT = 24;
const FALLEN_CAPTION_Y = CONTROL_ROW_Y + NODE_HEIGHT + 56;
const FALLEN_ROW_Y = FALLEN_CAPTION_Y + CAPTION_HEIGHT + 14;

interface EmployeeNodeData extends Record<string, unknown> {
  employee: Employee;
  tooltip?: string;
  onSelect: (traderId: string) => void;
}

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
 * Clickable (v3.1 plan) — opens the profile drawer for this trader; a
 * plain onClick is enough since `selectable`/`nodesDraggable` stay false
 * (this is a read-only diagram), but the node still needs its own
 * keyboard affordance since xyflow doesn't make custom nodes focusable. */
function EmployeeNodeView({ data }: NodeProps<EmployeeFlowNode>) {
  const { employee, tooltip, onSelect } = data;
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
          <span className="mood-emoji">{moodEmoji(employee.status, employee.bookMc)}</span>
        </div>
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
 * pattern as before). v3.1 adds the cycle's demissões/promoções counters
 * and a live "próxima avaliação" countdown to the next 00:00 UTC, computed
 * fresh on every render (plain Date math, no interval — see
 * `hoursUntilNextUtcMidnight`). No target handle: RH only ever originates
 * edges, never receives one. */
function RhNodeView({ data }: NodeProps<RhFlowNode>) {
  const { hours, minutes } = hoursUntilNextUtcMidnight(Date.now());
  return (
    <div className="org-rh-node" title={data.hrPolicy}>
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

/** Small mono caption labeling the fallen row ("galeria dos caídos") — a
 * plain text node, no handles, never a lineage/RH edge endpoint. */
function CaptionNodeView({ data }: NodeProps<CaptionFlowNode>) {
  return <div className="org-caption-node">{data.text}</div>;
}

const NODE_TYPES: NodeTypes = { employee: EmployeeNodeView, rh: RhNodeView, caption: CaptionNodeView };

/** Lays out one horizontal row of employee nodes, centered on x=0. */
function rowNodes(list: Employee[], y: number, onSelect: (traderId: string) => void): EmployeeFlowNode[] {
  const n = list.length;
  return list.map((employee, index) => ({
    id: employee.traderId,
    type: "employee",
    position: { x: (index - (n - 1) / 2) * ROW_STEP_X, y },
    measured: { width: NODE_WIDTH, height: NODE_HEIGHT },
    handles: [
      { type: "target", position: Position.Top, x: NODE_WIDTH / 2, y: 0 },
      { type: "source", position: Position.Bottom, x: NODE_WIDTH / 2, y: NODE_HEIGHT },
    ],
    data: { employee, tooltip: lineageTitle(employee), onSelect },
    draggable: false,
    selectable: false,
  }));
}

function buildGraph(
  employees: Employee[],
  hrPolicy: string,
  demissoes: number,
  promocoes: number,
  onSelect: (traderId: string) => void,
): { nodes: OrgFlowNode[]; edges: Edge[] } {
  const firmAll = employees.filter((e) => e.cohort === "evolved"); // RH edges + lineage sources span every status
  const firmLive = firmAll.filter((e) => e.status === "live");
  const controlLive = employees.filter((e) => e.cohort === "random" && e.status === "live");
  const fallen = employees.filter((e) => e.status !== "live"); // dead/fired, either cohort — v3.1 "galeria dos caídos"
  const employeeIds = new Set(employees.map((e) => e.traderId));

  const rhNode: RhFlowNode = {
    id: "rh",
    type: "rh",
    position: { x: -RH_WIDTH / 2, y: 0 },
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
    rhNode,
    ...rowNodes(firmLive, FIRM_ROW_Y, onSelect),
    ...rowNodes(controlLive, CONTROL_ROW_Y, onSelect),
  ];

  if (fallen.length > 0) {
    const captionWidth = Math.max(fallen.length * ROW_STEP_X - 24, 220);
    const captionNode: CaptionFlowNode = {
      id: "fallen-caption",
      type: "caption",
      position: { x: -captionWidth / 2, y: FALLEN_CAPTION_Y },
      measured: { width: captionWidth, height: CAPTION_HEIGHT },
      data: { text: "galeria dos caídos" },
      draggable: false,
      selectable: false,
    };
    nodes.push(captionNode, ...rowNodes(fallen, FALLEN_ROW_Y, onSelect));
  }

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
 * restructured into rows + click-to-open profile drawer in v3.1). RH
 * anchors top-center; below it, three rows: live firm traders, live
 * control traders, and (when any exist) a "galeria dos caídos" caption
 * plus row for anyone dead/fired. RH connects to every firm trader with a
 * faint hairline, and a parentTraderId mutation lineage draws its own
 * animated green edge labeled "mutação". Pan/zoom + fitView on mount only
 * — dragging and selection are disabled, this is a read-only
 * visualization, not an editor, EXCEPT clicking an employee node, which
 * opens that trader's profile drawer. No <Background> component: the
 * page's own static grain overlay (theme.css's `.page::after`) shows
 * through the panel instead.
 */
export function OrgGraph({ employees, hrPolicy, leaderboard, demissoes, promocoes }: OrgGraphProps) {
  const [selectedTraderId, setSelectedTraderId] = useState<string | null>(null);

  const { nodes, edges } = useMemo(
    () => buildGraph(employees, hrPolicy, demissoes, promocoes, setSelectedTraderId),
    [employees, hrPolicy, demissoes, promocoes],
  );

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
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
      >
        <Controls showInteractive={false} />
      </ReactFlow>

      <EmpresaDrawer
        employee={selectedEmployee}
        leaderboardEntry={selectedLeaderboardEntry}
        onClose={() => setSelectedTraderId(null)}
      />
    </div>
  );
}
