import type { PalcoGenome, PalcoSnapshot } from "../types";
import { usd, relativeTime } from "../format";
import { initials, avatarBackground } from "../avatar";
import { GenomeChips } from "../GenomeChips";

interface EmpresaTabProps {
  snapshot: PalcoSnapshot | null;
}

type Employee = PalcoSnapshot["org"]["employees"][number];
type HistoryItem = PalcoSnapshot["org"]["history"][number];

const STATUS_PT: Record<string, string> = { live: "vivo", dead: "morto", fired: "demitido" };
const STATUS_CLASS: Record<string, string> = { live: "status-live", dead: "status-dead", fired: "status-fired" };

const HISTORY_ICON: Record<string, string> = {
  gen_started: "🌱",
  gen_ended: "⚰️",
  trader_hired: "🤝",
  trader_fired: "📦",
  trader_promoted: "🏆",
};

/**
 * Lineage line under an employee's card. `org.employees` only carries
 * `parentTraderId`/`parentName` from the trader's OWN trader_hired event —
 * per the Task A report, generation-seed hires (elite-clone / elite-mutant
 * / immigrant, at the start of a generation) never record a parentTraderId
 * at all, only HR-review replacement hires mid-generation do. And
 * hireReplacement() in src/motor/hr.ts always calls mutateGenome() for
 * those — never an exact clone — so a non-null parentTraderId is
 * unambiguously a mutation. "continuação de X" (an exact clone) therefore
 * can't be honestly attributed to a specific named parent from the data
 * this snapshot exposes; we fall back to the generation's own seedNote
 * (e.g. "2 clones + 1 mutant") instead of guessing a name.
 */
function lineageLine(employee: Employee): string | null {
  if (employee.cohort === "random") return null; // the control cohort never carries a bred lineage
  if (employee.parentTraderId !== null) {
    return `↳ mutação de ${employee.parentName ?? "um trader anterior"}`;
  }
  if (employee.seedNote === "fresh") return "↳ contratação externa (genoma novo)";
  return `↳ geração evoluída — ${employee.seedNote}`;
}

function EmployeeCard({ employee, genome }: { employee: Employee; genome: PalcoGenome | undefined }) {
  const lineage = lineageLine(employee);

  return (
    <div className="employee-card">
      <div className="employee-avatar" style={{ background: avatarBackground(employee.name) }}>
        {initials(employee.name)}
      </div>
      <div className="employee-info">
        <div className="employee-name-row">
          <span className="employee-name">{employee.name}</span>
          <span className={`status-chip ${STATUS_CLASS[employee.status] ?? ""}`}>
            {STATUS_PT[employee.status] ?? employee.status}
          </span>
        </div>
        <div className="employee-cargo">
          Mesa {employee.symbol} · {employee.leverage}x
        </div>
        <div className="employee-book">{usd(employee.bookMc)}</div>
        <div className="employee-genome">
          {genome ? (
            <GenomeChips genome={genome} compact />
          ) : (
            <div className="genome-chips genome-chips--compact">
              <span className="chip chip-desk">
                {employee.symbol} · {employee.leverage}x
              </span>
            </div>
          )}
        </div>
        {lineage && <div className="lineage-line">{lineage}</div>}
      </div>
    </div>
  );
}

function HistoryRow({ item, nowMs }: { item: HistoryItem; nowMs: number }) {
  return (
    <li>
      <span className="history-icon">{HISTORY_ICON[item.type] ?? "•"}</span>
      {/*
        Safe: item.html is produced server-side by
        src/motor/palco-format.ts's formatEventPt, which escapes every
        payload value through escapeHtml before interpolation.
      */}
      <span dangerouslySetInnerHTML={{ __html: item.html }} />
      <span className="history-ts">{relativeTime(item.ts, nowMs)}</span>
    </li>
  );
}

export function EmpresaTab({ snapshot }: EmpresaTabProps) {
  const org = snapshot?.org;
  const employees = org?.employees ?? [];
  const history = org?.history ?? [];
  const nowMs = Date.now();

  // org.employees only exposes {symbol, leverage} — not the full genome
  // struct with its gene list. snapshot.leaderboard, however, pulls from
  // the exact same current-generation trader set and DOES carry the full
  // structured genome. Cross-referencing by name lets Empresa show real
  // GenomeChips without any Task A data-layer change.
  const genomeByName = new Map<string, PalcoGenome>(
    (snapshot?.leaderboard ?? []).map((trader) => [trader.name, trader.genome]),
  );

  const firmEmployees = employees.filter((e) => e.cohort === "evolved");
  const controlEmployees = employees.filter((e) => e.cohort === "random");

  const demissoes = history.filter((h) => h.type === "trader_fired").length;
  const promocoes = history.filter((h) => h.type === "trader_promoted").length;

  return (
    <div>
      <section className="rh-card">
        <h2 className="label">Recursos Humanos</h2>
        <p className="rh-policy">{org?.hrPolicy ?? ""}</p>
        <div className="rh-counters">
          <div>
            <span className="v">{demissoes}</span>
            <span className="label">demissões no ciclo</span>
          </div>
          <div>
            <span className="v">{promocoes}</span>
            <span className="label">promoções no ciclo</span>
          </div>
        </div>
      </section>

      <div className="org-columns">
        <div className="org-column">
          <h3 className="label">A Firma</h3>
          {firmEmployees.length === 0 && <p>Sem funcionários ainda.</p>}
          {firmEmployees.map((employee) => (
            <EmployeeCard key={employee.traderId} employee={employee} genome={genomeByName.get(employee.name)} />
          ))}
        </div>
        <div className="org-column">
          <h3 className="label">Controle</h3>
          {controlEmployees.length === 0 && <p>Sem funcionários ainda.</p>}
          {controlEmployees.map((employee) => (
            <EmployeeCard key={employee.traderId} employee={employee} genome={genomeByName.get(employee.name)} />
          ))}
        </div>
      </div>

      <section className="org-history">
        <h2 className="label">Histórico</h2>
        <ul className="history-timeline">
          {history.length === 0 && <li>Sem histórico ainda.</li>}
          {history.map((item) => (
            <HistoryRow key={item.id} item={item} nowMs={nowMs} />
          ))}
        </ul>
      </section>
    </div>
  );
}
