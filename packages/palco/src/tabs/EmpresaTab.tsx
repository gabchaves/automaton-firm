import type { PalcoSnapshot } from "../types";
import { relativeTime } from "../format";
import { OrgGraph } from "./OrgGraph";

interface EmpresaTabProps {
  snapshot: PalcoSnapshot | null;
}

type HistoryItem = PalcoSnapshot["org"]["history"][number];

const HISTORY_ICON: Record<string, string> = {
  gen_started: "🌱",
  gen_ended: "⚰️",
  trader_hired: "🤝",
  trader_fired: "📦",
  trader_promoted: "🏆",
};

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

  const demissoes = history.filter((h) => h.type === "trader_fired").length;
  const promocoes = history.filter((h) => h.type === "trader_promoted").length;

  return (
    <div>
      <section className="rh-card">
        <h2 className="section-title">Recursos Humanos</h2>
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

      <h2 className="section-title">Organograma</h2>
      {employees.length === 0 ? (
        <p className="empty-state">Sem funcionários ainda.</p>
      ) : (
        <OrgGraph employees={employees} hrPolicy={org?.hrPolicy ?? ""} />
      )}

      <section className="org-history">
        <h2 className="section-title">Histórico</h2>
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
