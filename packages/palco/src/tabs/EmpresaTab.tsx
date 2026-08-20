import type { PalcoSnapshot } from "../types";
import { relativeTime, hoursUntilNextUtcMidnight, usd } from "../format";
import { STAKE_MC } from "../mood";
import { EmpresaRoster } from "./EmpresaRoster";

interface EmpresaTabProps {
  snapshot: PalcoSnapshot | null;
}

type HistoryItem = PalcoSnapshot["org"]["history"][number];
type LeaderboardEntry = PalcoSnapshot["leaderboard"][number];

/**
 * CEO = whoever's actually winning: the live evolved trader with the
 * biggest book right now. No vacant seat, no appointee — the title moves
 * every time someone takes the lead, which is the honest version of "CEO"
 * this firm can make: earned by book, not by résumé.
 */
function pickCeo(leaderboard: LeaderboardEntry[]): LeaderboardEntry | null {
  const contenders = leaderboard.filter((entry) => entry.cohort === "evolved" && entry.status === "live");
  if (contenders.length === 0) return null;
  return contenders.reduce((best, entry) => (entry.bookMc > best.bookMc ? entry : best));
}

const HISTORY_ICON: Record<string, string> = {
  gen_started: "🌱",
  gen_ended: "⚰️",
  trader_hired: "🤝",
  trader_fired: "📦",
  trader_rotated: "🔄",
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
  // Sane fallback (STAKE_MC) while there's no snapshot yet; every real
  // render derives from cards.traderStartMc instead, so a bankroll scale
  // change never touches this file (or EmpresaRoster/EmpresaDrawer) again.
  const stakeMc = snapshot?.cards.traderStartMc ?? STAKE_MC;

  const demissoes = history.filter((h) => h.type === "trader_fired").length;
  const rotacoes = history.filter((h) => h.type === "trader_rotated").length;
  const promocoes = history.filter((h) => h.type === "trader_promoted").length;
  const { hours, minutes } = hoursUntilNextUtcMidnight(nowMs);
  const ceo = pickCeo(snapshot?.leaderboard ?? []);

  return (
    <div className="empresa-blocks">
      <div className="leadership-row">
        <section className="ceo-card">
          <div className="rh-card-heading">
            <span className="org-rh-icon" aria-hidden="true">
              🧬
            </span>
            <span className="ceo-kicker">CEO</span>
          </div>
          {ceo ? (
            <>
              <h2 className="ceo-name section-title">{ceo.name}</h2>
              <p className="rh-policy">
                Eleito pelo mercado, não por currículo: o cargo vai automaticamente para quem lidera o book da firma
                agora, sem indicação nem processo seletivo. Nada de plano de carreira — só o ranking, atualizado a
                cada rodada.
              </p>
              <div className="rh-counters">
                <div>
                  <span className="v">{usd(ceo.bookMc)}</span>
                  <span className="label">sob gestão</span>
                </div>
                <div>
                  <span className={ceo.realizedPnlMc < 0 ? "v pnl-neg" : "v pnl-pos"}>{usd(ceo.realizedPnlMc)}</span>
                  <span className="label">lucro realizado</span>
                </div>
                <div>
                  <span className="v">{ceo.tradesCount}</span>
                  <span className="label">trades no ciclo</span>
                </div>
              </div>
              <p className="rh-next-review">
                O cargo muda de mãos toda vez que alguém supera — sem herança, sem política interna.
              </p>
            </>
          ) : (
            <p className="rh-policy">Cargo em disputa — ninguém assumiu a liderança ainda.</p>
          )}
        </section>

        <section className="rh-card">
          <div className="rh-card-heading">
            <span className="org-rh-icon" aria-hidden="true">
              🗂️
            </span>
            <h2 className="section-title">Recursos Humanos</h2>
          </div>
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
            <div>
              <span className="v">{rotacoes}</span>
              <span className="label">rotações no ciclo</span>
            </div>
          </div>
          <p className="rh-next-review">
            próxima avaliação em {hours}h{String(minutes).padStart(2, "0")}
          </p>
        </section>
      </div>

      <div className="roster-block">
        <h2 className="section-title">Organograma</h2>
        <p className="org-explainer">
          Como a firma se organiza: o RH avalia todo mundo semanalmente contra o benchmark. Sêniores herdam genomas
          de elite; trainees são apostas do RH no meio do ciclo; o grupo de controle joga moeda — e nos mantém
          honestos.
        </p>
        {employees.length === 0 ? (
          <p className="empty-state">Sem funcionários ainda.</p>
        ) : (
          <EmpresaRoster employees={employees} leaderboard={snapshot?.leaderboard ?? []} stakeMc={stakeMc} />
        )}
      </div>

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
