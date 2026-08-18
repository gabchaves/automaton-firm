import { useMemo } from "react";
import { ReactFlow, Controls, Handle, Position, type Node, type Edge, type NodeProps, type NodeTypes } from "@xyflow/react";
import type { PalcoSnapshot } from "../types";
import { usd } from "../format";
import { initials, avatarBackground } from "../avatar";
import { moodEmoji } from "../mood";

type Employee = PalcoSnapshot["org"]["employees"][number];

interface OrgGraphProps {
  employees: Employee[];
  hrPolicy: string;
}

const STATUS_PT: Record<string, string> = { live: "vivo", dead: "morto", fired: "demitido" };
const STATUS_CLASS: Record<string, string> = { live: "status-live", dead: "status-dead", fired: "status-fired" };

/**
 * Lineage tooltip text for an employee's node — the exact wording the old
 * card-grid layout showed as an always-visible "↳ ..." line (see the v2
 * EmpresaTab). A mutation lineage now draws its own graph edge (labeled
 * "mutação", see buildGraph below) so that case no longer needs the text
 * to carry the relationship — but the non-mutation cases (fresh external
 * hire, or a generation-evolved seed with no traceable parent node) never
 * had an edge to draw either way, only text. Surfacing all four cases as a
 * native `title` tooltip — rather than dropping the non-mutation ones —
 * keeps that information reachable without adding visible clutter to the
 * graph, the same pattern the RH node uses for `hrPolicy`.
 */
function lineageTitle(employee: Employee): string | undefined {
  if (employee.cohort === "random") return undefined; // control cohort never carries a bred lineage
  if (employee.parentTraderId !== null) {
    return `↳ mutação de ${employee.parentName ?? "um trader anterior"}`;
  }
  if (employee.seedNote === "fresh") return "↳ contratação externa (genoma novo)";
  return `↳ geração evoluída — ${employee.seedNote}`;
}

// ---------- Layout ----------
// Fixed, hand-tuned coordinates — no auto-layout dependency (dagre/elk are
// not part of this dep budget): RH sits top-center, firm (evolved) traders
// stack in a left column, control (random) traders stack in a right
// column. `fitView` (see <ReactFlow> below) pans/scales the viewport to
// whatever this produces, so these only need to keep the three clusters
// visually distinct, not be pixel-perfect.
const RH_WIDTH = 120;
const RH_HEIGHT = 56;
const NODE_WIDTH = 176;
const NODE_HEIGHT = 92;
const FIRM_X = -340;
const CONTROL_X = 180;
const ROW_START_Y = 170;
const ROW_GAP = 112;

interface EmployeeNodeData extends Record<string, unknown> {
  employee: Employee;
  tooltip?: string;
}

interface RhNodeData extends Record<string, unknown> {
  hrPolicy: string;
}

type EmployeeFlowNode = Node<EmployeeNodeData, "employee">;
type RhFlowNode = Node<RhNodeData, "rh">;
type OrgFlowNode = EmployeeFlowNode | RhFlowNode;

/** Compact employee card: square avatar, name + mood emoji, book (mono),
 * status chip. Dead/fired nodes render at 55% opacity via `.org-node-dim`. */
function EmployeeNodeView({ data }: NodeProps<EmployeeFlowNode>) {
  const { employee, tooltip } = data;
  const dim = employee.status !== "live";

  return (
    <div className={`org-node${dim ? " org-node-dim" : ""}`} title={tooltip}>
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
 * pattern as the RH counters card above the graph). No target handle: RH
 * only ever originates edges, never receives one. */
function RhNodeView({ data }: NodeProps<RhFlowNode>) {
  return (
    <div className="org-rh-node" title={data.hrPolicy}>
      RH
      <Handle type="source" position={Position.Bottom} className="org-node-handle" />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { employee: EmployeeNodeView, rh: RhNodeView };

function buildGraph(employees: Employee[], hrPolicy: string): { nodes: OrgFlowNode[]; edges: Edge[] } {
  const firm = employees.filter((e) => e.cohort === "evolved");
  const control = employees.filter((e) => e.cohort === "random");
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
    data: { hrPolicy },
    draggable: false,
    selectable: false,
  };

  const columnNodes = (list: Employee[], x: number): EmployeeFlowNode[] =>
    list.map((employee, index) => ({
      id: employee.traderId,
      type: "employee",
      position: { x, y: ROW_START_Y + index * ROW_GAP },
      measured: { width: NODE_WIDTH, height: NODE_HEIGHT },
      handles: [
        { type: "target", position: Position.Top, x: NODE_WIDTH / 2, y: 0 },
        { type: "source", position: Position.Bottom, x: NODE_WIDTH / 2, y: NODE_HEIGHT },
      ],
      data: { employee, tooltip: lineageTitle(employee) },
      draggable: false,
      selectable: false,
    }));

  const nodes: OrgFlowNode[] = [rhNode, ...columnNodes(firm, FIRM_X), ...columnNodes(control, CONTROL_X)];

  const edges: Edge[] = [];
  for (const employee of firm) {
    // RH -> every firm trader, per the v3 plan's Task 3 ("RH → every firm
    // trader"). Control traders are the random baseline, not an HR-managed
    // cohort, so they never get this edge.
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
    // only skips drawing an edge to a node that doesn't exist — the v3
    // plan's "keep it uncluttered" implementer judgment for gen-seed
    // anchors, resolved here as "no edge" rather than an invisible anchor
    // node, since the tooltip already carries the information.
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
 * Empresa's org chart as an interactive lineage graph (v3 plan Task 3),
 * replacing the old two-column employee card grid. RH anchors top-center,
 * firm (evolved) traders stack left, control (random) traders stack right;
 * RH connects to every firm trader with a faint hairline, and a
 * parentTraderId mutation lineage draws its own animated dashed green edge
 * labeled "mutação". Pan/zoom + fitView on mount only — dragging and
 * selection are disabled, this is a read-only visualization, not an
 * editor. No <Background> component: the page's own static grain overlay
 * (theme.css's `.page::after`) shows through the panel instead.
 */
export function OrgGraph({ employees, hrPolicy }: OrgGraphProps) {
  const { nodes, edges } = useMemo(() => buildGraph(employees, hrPolicy), [employees, hrPolicy]);

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
    </div>
  );
}
