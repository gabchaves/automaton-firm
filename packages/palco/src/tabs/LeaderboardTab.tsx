import { motion, AnimatePresence } from "framer-motion";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import type { PalcoSnapshot } from "../types";
import { usd } from "../format";
import { initials, avatarBackground } from "../avatar";
import { moodEmoji, STAKE_MC } from "../mood";

interface LeaderboardTabProps {
  snapshot: PalcoSnapshot | null;
}

type LeaderboardEntry = PalcoSnapshot["leaderboard"][number];
type RankedRow = LeaderboardEntry & { rank: number; id: string };

const STATUS_PT: Record<string, string> = {
  live: "vivo",
  dead: "morto",
  fired: "demitido",
};

const STATUS_ICON: Record<string, string> = {
  dead: "💀",
  fired: "📦",
};

// Same status -> chip-color mapping as EmpresaTab's STATUS_CLASS (kept as a
// local constant per this codebase's existing per-tab convention rather
// than a shared module).
const STATUS_CLASS: Record<string, string> = { live: "status-live", dead: "status-dead", fired: "status-fired" };

const PODIUM_MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function pnlClass(mc: number): string {
  return mc >= 0 ? "pnl-value pnl-pos" : "pnl-value pnl-neg";
}

/**
 * Top-3 podium strip, rendered above the DataTable. PrimeReact's DataTable
 * can't take framer-motion's `layout` prop on its own (recycled/virtualized)
 * row elements, so per the v3 plan's Task 2 note ("implementer picks the
 * cheaper one that looks good") this small standalone strip is the thing
 * that actually animates rank reordering — the DataTable itself just
 * re-renders in the new order underneath it.
 */
function PodiumStrip({ rows }: { rows: RankedRow[] }) {
  const top3 = rows.slice(0, 3);
  if (top3.length === 0) return null;

  return (
    <div className="podium-strip">
      <AnimatePresence initial={false}>
        {top3.map((row) => (
          <motion.div
            key={row.traderId}
            layout
            transition={{ duration: 0.3, ease: "easeOut" }}
            className={`podium-card podium-rank-${row.rank}`}
          >
            <span className="podium-medal">{PODIUM_MEDAL[row.rank]}</span>
            <span className="podium-mood">{moodEmoji(row.status, row.bookMc)}</span>
            <span className="podium-name">{row.name}</span>
            <span className="podium-book">{usd(row.bookMc)}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** LMArena-style ranked leaderboard — one of the product's named identity
 * anchors, kept alongside (not replaced by) the Empresa org chart: this
 * view ranks current traders by book size; Empresa shows org structure
 * and lineage. Cleaned per the v3 plan's Task 2: genoma/conquistas columns
 * (too abstract per user feedback) are gone; achievements shrink to a
 * single mono badge, and rank/mood/P&L% replace them. */
export function LeaderboardTab({ snapshot }: LeaderboardTabProps) {
  const rows: RankedRow[] = (snapshot?.leaderboard ?? []).map((trader, index) => ({
    ...trader,
    rank: index + 1,
    id: `${trader.cohort}-${trader.genNumber}-${trader.name}-${index}`,
  }));

  return (
    <div>
      <PodiumStrip rows={rows} />

      <DataTable value={rows} dataKey="id" className="leaderboard-table">
        <Column
          header="#"
          body={(row: RankedRow) =>
            row.rank <= 3 ? (
              <span className="rank-chip">{row.rank}</span>
            ) : (
              <span className="rank-plain">{row.rank}</span>
            )
          }
          style={{ width: "3rem" }}
        />
        <Column
          header="Nome"
          body={(row: RankedRow) => (
            <span className="row-name-cell">
              <span className="mini-avatar" style={{ background: avatarBackground(row.name) }}>
                {initials(row.name)}
              </span>
              <span className="row-name-text">
                {row.name}
                <span className="mood-emoji">{moodEmoji(row.status, row.bookMc)}</span>
                {row.achievements.length > 0 && (
                  <span className="achv-badge" title={row.achievements.join(", ")}>
                    ✨{row.achievements.length}
                  </span>
                )}
              </span>
            </span>
          )}
        />
        <Column
          header="Time"
          body={(row: RankedRow) => (
            <Tag
              value={row.cohort === "evolved" ? "firma" : "controle"}
              severity={row.cohort === "evolved" ? "success" : "secondary"}
            />
          )}
        />
        <Column header="Gen" body={(row: RankedRow) => `G${row.genNumber}`} />
        <Column
          header="Status"
          body={(row: RankedRow) => (
            <span className={`status-chip ${STATUS_CLASS[row.status] ?? ""}`}>
              {STATUS_ICON[row.status] ?? ""} {STATUS_PT[row.status] ?? row.status}
            </span>
          )}
        />
        <Column header="Book" body={(row: RankedRow) => <span className="mono-bold">{usd(row.bookMc)}</span>} />
        <Column
          header="P&L realizado"
          body={(row: RankedRow) => <span className={pnlClass(row.realizedPnlMc)}>{usd(row.realizedPnlMc)}</span>}
        />
        <Column
          header="P&L %"
          body={(row: RankedRow) => {
            const pct = (row.realizedPnlMc / STAKE_MC) * 100;
            return <span className={pnlClass(row.realizedPnlMc)}>{pct.toFixed(1)}%</span>;
          }}
        />
        <Column header="Trades" field="tradesCount" />
        <Column header="Mesa" body={(row: RankedRow) => `${row.symbol} · ${row.leverage}x`} />
      </DataTable>
    </div>
  );
}
