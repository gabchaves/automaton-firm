import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { PalcoSnapshot } from "../types";
import { usd, absoluteDate } from "../format";
import { initials, avatarBackground } from "../avatar";
import { moodEmoji } from "../mood";
import { lineageLine, type Employee } from "../lineage";
import { combinatorPhrase, geneChipLabel } from "../genome-format";
import { cargoForEmployee } from "../cargo";

type LeaderboardEntry = PalcoSnapshot["leaderboard"][number];

interface EmpresaDrawerProps {
  employee: Employee | null; // null = closed
  leaderboardEntry: LeaderboardEntry | null;
  onClose: () => void;
  stakeMc: number; // snapshot.cards.traderStartMc (or its fallback) — see mood.ts
}

const STATUS_PT: Record<string, string> = { live: "vivo", dead: "morto", fired: "demitido" };
const STATUS_CLASS: Record<string, string> = { live: "status-live", dead: "status-dead", fired: "status-fired" };

/**
 * Right-side employee profile drawer for the Empresa org graph (v3.1
 * plan). Opened by clicking an employee node (see OrgGraph.tsx); joins the
 * clicked org.employees row with its matching snapshot.leaderboard row by
 * traderId for the trade-desk fields the compact org node itself doesn't
 * carry (P&L, trade count, achievements, genome). A leaderboard row can be
 * legitimately absent (e.g. a generation seed that's no longer in the live
 * ranking), so those sections fall back to a short note rather than
 * silently rendering blank.
 *
 * This is the genome's new home: it was pulled off the Leaderboard as too
 * abstract (see LeaderboardTab.tsx) — here it gets room to read as a
 * sentence + labeled chips instead of a bare params dump.
 */
export function EmpresaDrawer({ employee, leaderboardEntry, onClose, stakeMc }: EmpresaDrawerProps) {
  useEffect(() => {
    if (!employee) return undefined;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [employee, onClose]);

  return (
    <AnimatePresence>
      {employee && (
        <motion.div
          className="empresa-drawer-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.aside
            className="empresa-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Perfil de ${employee.name}`}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            onClick={(event) => event.stopPropagation()}
          >
            <DrawerContent employee={employee} leaderboardEntry={leaderboardEntry} onClose={onClose} stakeMc={stakeMc} />
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface DrawerContentProps {
  employee: Employee;
  leaderboardEntry: LeaderboardEntry | null;
  onClose: () => void;
  stakeMc: number;
}

function DrawerContent({ employee, leaderboardEntry, onClose, stakeMc }: DrawerContentProps) {
  const lineage = lineageLine(employee);
  const genome = leaderboardEntry?.genome;
  const achievements = leaderboardEntry?.achievements ?? [];
  const cargo = cargoForEmployee(employee, leaderboardEntry);
  const pnlClass = leaderboardEntry
    ? `mono-bold ${leaderboardEntry.realizedPnlMc >= 0 ? "pnl-value pnl-pos" : "pnl-value pnl-neg"}`
    : "mono-bold";

  return (
    <div className="empresa-drawer-content">
      <button type="button" className="empresa-drawer-close" onClick={onClose} aria-label="Fechar perfil">
        ✕
      </button>

      <div className="empresa-drawer-header">
        <div className="empresa-drawer-avatar" style={{ background: avatarBackground(employee.name) }}>
          {initials(employee.name)}
          <span className="empresa-drawer-mood">{moodEmoji(employee.status, employee.bookMc, stakeMc)}</span>
        </div>
        <div>
          <h2 className="empresa-drawer-name">{employee.name}</h2>
          <div className="label empresa-drawer-titulo">{cargo.titulo}</div>
          <div className="empresa-drawer-cargo">
            Mesa {employee.symbol} · {employee.leverage}x
          </div>
          <span className={`status-chip ${STATUS_CLASS[employee.status] ?? ""}`}>
            {STATUS_PT[employee.status] ?? employee.status}
          </span>
        </div>
      </div>

      <section>
        <h3 className="empresa-drawer-subtitle label">Papel na firma</h3>
        <p className="empresa-drawer-papel">{cargo.papel}</p>
      </section>

      <dl className="empresa-drawer-stats">
        <div>
          <dt className="label">Book</dt>
          <dd className="mono-bold">{usd(employee.bookMc)}</dd>
        </div>
        <div>
          <dt className="label">P&amp;L realizado</dt>
          <dd className={pnlClass}>{leaderboardEntry ? usd(leaderboardEntry.realizedPnlMc) : "—"}</dd>
        </div>
        <div>
          <dt className="label">Trades</dt>
          <dd className="mono-bold">{leaderboardEntry ? leaderboardEntry.tradesCount : "—"}</dd>
        </div>
      </dl>

      <p className="empresa-drawer-since">na firma desde {absoluteDate(employee.bornAt)}</p>
      {lineage && <p className="empresa-drawer-lineage">↳ {lineage}</p>}

      <section>
        <h3 className="empresa-drawer-subtitle label">Conquistas</h3>
        {achievements.length > 0 ? (
          <ul className="empresa-drawer-achievements">
            {achievements.map((achievement) => (
              <li key={achievement}>✨ {achievement}</li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">nenhuma conquista ainda</p>
        )}
      </section>

      <section>
        <h3 className="empresa-drawer-subtitle label">Genoma</h3>
        {genome ? (
          <>
            <p className="empresa-drawer-genome-sentence">{combinatorPhrase(genome.combinator)}</p>
            <div className="genome-chips">
              {genome.genes.map((gene, index) => (
                <span className="chip" key={`${gene.family}-${index}`}>
                  {geneChipLabel(gene)}
                </span>
              ))}
              <span className="chip chip-desk">risco {genome.riskFraction} do book</span>
            </div>
          </>
        ) : (
          <p className="empty-state">sem dados de mesa desta geração</p>
        )}
      </section>
    </div>
  );
}
