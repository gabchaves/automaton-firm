import { motion, AnimatePresence } from "framer-motion";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import type { PalcoSnapshot } from "../types";
import { usd } from "../format";
import { initials, avatarBackground } from "../avatar";
import { moodEmoji, STAKE_MC } from "../mood";
import {
  orderLeaderboardRows, isDividerRow, isLiveRankedRow,
  type DisplayRow, type RankedRow,
} from "../leaderboard-order";

interface LeaderboardTabProps {
  snapshot: PalcoSnapshot | null;
}

/** Renders `render` for a real trader row, `null` (an empty cell) for the
 * synthetic "encerrados" divider row — used by every Column except "Nome",
 * which renders the divider's own label instead. */
function renderCell<T>(row: DisplayRow, render: (row: RankedRow) => T): T | null {
  return isDividerRow(row) ? null : render(row);
}

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
function PodiumStrip({ rows, stakeMc }: { rows: (RankedRow & { rank: number })[]; stakeMc: number }) {
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
            <span className="podium-mood">{moodEmoji(row.status, row.bookMc, stakeMc)}</span>
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
  // Sorted explicitly on the client (cinto e suspensório — see
  // leaderboard-order.ts): live rows first, then fired, then dead, within
  // each cohort; a divider marker sits between the two tiers when the
  // cohort actually has a non-live row.
  const displayRows: DisplayRow[] = orderLeaderboardRows(snapshot?.leaderboard ?? []);
  const liveRows = displayRows.filter(isLiveRankedRow);
  // Sane fallback (STAKE_MC) while there's no snapshot yet; every real
  // render derives from cards.traderStartMc instead, so a bankroll scale
  // change never touches this file again.
  const stakeMc = snapshot?.cards.traderStartMc ?? STAKE_MC;

  return (
    <div>
      <PodiumStrip rows={liveRows.slice(0, 3)} stakeMc={stakeMc} />

      <DataTable
        value={displayRows}
        dataKey="id"
        className="leaderboard-table"
        rowClassName={(row: DisplayRow) => {
          if (isDividerRow(row)) return "leaderboard-divider-row";
          return row.status !== "live" ? "leaderboard-row-muted" : "";
        }}
      >
        <Column
          header="#"
          body={(row: DisplayRow) =>
            renderCell(row, (r) =>
              r.rank === null ? null : r.rank <= 3 ? (
                <span className="rank-chip">{r.rank}</span>
              ) : (
                <span className="rank-plain">{r.rank}</span>
              ),
            )
          }
          style={{ width: "3rem" }}
        />
        <Column
          header="Nome"
          body={(row: DisplayRow) =>
            isDividerRow(row) ? (
              <span className="leaderboard-divider-label">— encerrados —</span>
            ) : (
              <span className="row-name-cell">
                <span className="mini-avatar" style={{ background: avatarBackground(row.name) }}>
                  {initials(row.name)}
                </span>
                <span className="row-name-text">
                  {row.name}
                  <span className="mood-emoji">{moodEmoji(row.status, row.bookMc, stakeMc)}</span>
                  {row.achievements.length > 0 && (
                    <span className="achv-badge" title={row.achievements.join(", ")}>
                      ✨{row.achievements.length}
                    </span>
                  )}
                </span>
              </span>
            )
          }
        />
        <Column
          header="Time"
          body={(row: DisplayRow) =>
            renderCell(row, (r) => (
              <Tag
                value={r.cohort === "evolved" ? "firma" : "controle"}
                severity={r.cohort === "evolved" ? "success" : "secondary"}
              />
            ))
          }
        />
        <Column header="Gen" body={(row: DisplayRow) => renderCell(row, (r) => `G${r.genNumber}`)} />
        <Column
          header="Status"
          body={(row: DisplayRow) =>
            renderCell(row, (r) => (
              <span className={`status-chip ${STATUS_CLASS[r.status] ?? ""}`}>
                {STATUS_ICON[r.status] ?? ""} {STATUS_PT[r.status] ?? r.status}
              </span>
            ))
          }
        />
        <Column
          header="Book"
          body={(row: DisplayRow) => renderCell(row, (r) => <span className="mono-bold">{usd(r.bookMc)}</span>)}
        />
        <Column
          header="P&L realizado"
          body={(row: DisplayRow) =>
            renderCell(row, (r) => <span className={pnlClass(r.realizedPnlMc)}>{usd(r.realizedPnlMc)}</span>)
          }
        />
        <Column
          header="P&L %"
          body={(row: DisplayRow) =>
            renderCell(row, (r) => {
              const pct = (r.realizedPnlMc / stakeMc) * 100;
              return <span className={pnlClass(r.realizedPnlMc)}>{pct.toFixed(1)}%</span>;
            })
          }
        />
        <Column header="Trades" body={(row: DisplayRow) => renderCell(row, (r) => r.tradesCount)} />
        <Column header="Mesa" body={(row: DisplayRow) => renderCell(row, (r) => `${r.symbol} · ${r.leverage}x`)} />
      </DataTable>
    </div>
  );
}
