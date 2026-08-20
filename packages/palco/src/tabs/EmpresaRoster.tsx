import { useMemo, useState, type KeyboardEvent } from "react";
import type { PalcoSnapshot } from "../types";
import { usd } from "../format";
import { initials, avatarBackground } from "../avatar";
import { moodEmoji } from "../mood";
import { lineageLine, type Employee } from "../lineage";
import { cargoForEmployee } from "../cargo";
import { orderRowsByStatus } from "../row-order";
import { EmpresaDrawer } from "./EmpresaDrawer";

type LeaderboardEntry = PalcoSnapshot["leaderboard"][number];

interface EmpresaRosterProps {
  employees: Employee[];
  leaderboard: LeaderboardEntry[];
  stakeMc: number; // snapshot.cards.traderStartMc (or its fallback) — see mood.ts
}

const STATUS_PT: Record<string, string> = { live: "vivo", dead: "morto", fired: "demitido" };
const STATUS_CLASS: Record<string, string> = { live: "status-live", dead: "status-dead", fired: "status-fired" };

/**
 * v4.3 plan: replaces `OrgGraph.tsx`'s xyflow canvas. The graph was a
 * recurring "amontoado" (crowded) complaint across three rounds — this is a
 * deliberate simplification back to a plain, tidy vertical list, the same
 * orderly quality the Leaderboard tab already has (see `row-order.ts`,
 * shared by both). No canvas, no absolute positioning, no pan/zoom.
 */

export interface EmpresaRosterRows {
  firmLive: Employee[];
  controlLive: Employee[];
  closed: Employee[];
}

/**
 * Builds the roster's row groups, reusing the SAME cohort/status ordering
 * contract as the Leaderboard (`orderRowsByStatus`, row-order.ts): live
 * rows grouped by cohort (book desc within cohort), then every closed seat
 * (fired before dead, book desc within tier) from BOTH cohorts together at
 * the true end of the whole roster — not just the end of its own cohort's
 * block. `firmLive`/`controlLive` are simple filters over the already-
 * ordered `live` array, so their internal book-desc order is preserved.
 */
export function buildRoster(employees: Employee[]): EmpresaRosterRows {
  const { live, closed } = orderRowsByStatus(employees);
  return {
    firmLive: live.filter((employee) => employee.cohort === "evolved"),
    controlLive: live.filter((employee) => employee.cohort === "random"),
    closed,
  };
}

/** Resolves the cargo title (job title chip) for one employee by joining
 * against `leaderboard` — a generation seed with no live leaderboard row
 * just yields a degraded-but-non-crashing cargo (cargoForEmployee handles
 * `families: []` gracefully). */
function cargoTituloFor(employee: Employee, leaderboard: LeaderboardEntry[]): string {
  const leaderboardEntry = leaderboard.find((entry) => entry.traderId === employee.traderId) ?? null;
  return cargoForEmployee(employee, leaderboardEntry).titulo;
}

interface EmployeeRowProps {
  employee: Employee;
  cargoTitulo: string;
  onSelect: (traderId: string) => void;
  stakeMc: number;
}

/**
 * One roster row: the compact employee card (avatar, name + mood emoji,
 * cargo, book, status chip — reused from the pre-v4.2 graph nodes' own
 * `.org-node` markup) plus its lineage line underneath, rendered as plain
 * visible text again instead of a hover tooltip — the `lineageLine` branch
 * logic (mutação/externa/seedNote-fallback/no-lineage-for-random) is
 * unchanged, only its presentation moves back to how it read before the
 * graph existed at all.
 */
function EmployeeRow({ employee, cargoTitulo, onSelect, stakeMc }: EmployeeRowProps) {
  const lineage = lineageLine(employee);
  const dim = employee.status !== "live";

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(employee.traderId);
    }
  }

  return (
    <li className="roster-row">
      <div
        className={`org-node${dim ? " org-node-dim" : ""}`}
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
      {lineage && <div className="roster-row-lineage">↳ {lineage}</div>}
    </li>
  );
}

interface RosterSectionProps {
  title: string;
  headerClassName: string;
  employees: Employee[];
  leaderboard: LeaderboardEntry[];
  onSelect: (traderId: string) => void;
  stakeMc: number;
}

/** One labeled group ("A Firma" / "Controle" / "Encerrados") — omitted
 * entirely when its list is empty, same "no header for an empty tier"
 * behavior the graph's caption nodes had. `headerClassName` lets the live
 * groups keep the big Anton `.section-title` treatment while Encerrados
 * keeps its own quieter, muted framing (`.org-fallen-header`, unchanged
 * from the last round — still "its own tier," just a plain list now). */
function RosterSection({ title, headerClassName, employees, leaderboard, onSelect, stakeMc }: RosterSectionProps) {
  if (employees.length === 0) return null;
  return (
    <div className="roster-section">
      <h3 className={headerClassName}>{title}</h3>
      <ul className="roster-list">
        {employees.map((employee) => (
          <EmployeeRow
            key={employee.traderId}
            employee={employee}
            cargoTitulo={cargoTituloFor(employee, leaderboard)}
            onSelect={onSelect}
            stakeMc={stakeMc}
          />
        ))}
      </ul>
    </div>
  );
}

export function EmpresaRoster({ employees, leaderboard, stakeMc }: EmpresaRosterProps) {
  const [selectedTraderId, setSelectedTraderId] = useState<string | null>(null);

  const { firmLive, controlLive, closed } = useMemo(() => buildRoster(employees), [employees]);

  const selectedEmployee = selectedTraderId
    ? (employees.find((e) => e.traderId === selectedTraderId) ?? null)
    : null;
  const selectedLeaderboardEntry = selectedTraderId
    ? (leaderboard.find((l) => l.traderId === selectedTraderId) ?? null)
    : null;

  return (
    <>
      <div className="roster-live-block">
        <div className="roster-live-groups">
          <RosterSection
            title="A Firma"
            headerClassName="section-title roster-section-title"
            employees={firmLive}
            leaderboard={leaderboard}
            onSelect={setSelectedTraderId}
            stakeMc={stakeMc}
          />
          <RosterSection
            title="Controle"
            headerClassName="section-title roster-section-title"
            employees={controlLive}
            leaderboard={leaderboard}
            onSelect={setSelectedTraderId}
            stakeMc={stakeMc}
          />
        </div>
      </div>

      {/* The roster's one shared divider: closed seats from BOTH cohorts
          render together here, at the true end of the list, behind this
          single "Encerrados" header — never split per cohort, never mixed
          back into the live groups above (same contract as the
          Leaderboard's divider row, row-order.ts). */}
      {closed.length > 0 && (
        <div className="roster-closed-block">
          <RosterSection
            title="Encerrados"
            headerClassName="org-fallen-header"
            employees={closed}
            leaderboard={leaderboard}
            onSelect={setSelectedTraderId}
            stakeMc={stakeMc}
          />
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
