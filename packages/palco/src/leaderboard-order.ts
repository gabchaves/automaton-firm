import type { PalcoSnapshot } from "./types";
import { orderRowsByStatus } from "./row-order";

export type LeaderboardEntry = PalcoSnapshot["leaderboard"][number];

export interface RankedRow extends LeaderboardEntry {
  rank: number | null; // only live rows get a rank — see orderLeaderboardRows
  id: string;
}

export interface DividerRow {
  id: string;
  isDivider: true;
  cohort: null; // one shared divider for the whole closed-seats block, no single cohort owns it
}

export type DisplayRow = RankedRow | DividerRow;

export function isDividerRow(row: DisplayRow): row is DividerRow {
  return "isDivider" in row;
}

export function isLiveRankedRow(row: DisplayRow): row is RankedRow & { rank: number } {
  return !isDividerRow(row) && row.status === "live" && row.rank !== null;
}

/**
 * v4.1 fix: "joga os demitidos pro final da lista" meant the END OF THE
 * WHOLE TABLE, not just the end of their own cohort's block. The previous
 * version demoted a fired trader only within its cohort — since cohorts are
 * displayed one after another (all Firma rows, then all Controle rows), a
 * Firma seat closed out mid-table still landed ABOVE every live Controle
 * row, which reads as "stuck in the middle," not "at the end."
 *
 * Two passes now: every LIVE row first (still grouped by cohort in the
 * order cohorts first appear, book desc within each — the team-grouped
 * display people already know), THEN one divider, THEN every non-live row
 * from BOTH cohorts together (fired before dead, book desc within each
 * tier) at the true bottom of the list. Rank numbers (#1, #2, ...) are
 * assigned only to live rows, counted continuously.
 *
 * v4.3: the cohort/status grouping itself is now `row-order.ts`'s
 * `orderRowsByStatus`, shared with Empresa's roster list — this function's
 * own job shrinks to rank assignment, id generation, and the divider row,
 * which are Leaderboard-table-specific (Empresa's roster has no `rank`
 * concept and renders its divider as a plain "Encerrados" section header
 * instead of a synthetic table row).
 */
export function orderLeaderboardRows(entries: LeaderboardEntry[]): DisplayRow[] {
  const { live, closed } = orderRowsByStatus(entries);

  const out: DisplayRow[] = [];

  live.forEach((entry, index) => {
    out.push({ ...entry, rank: index + 1, id: `${entry.cohort}-live-${entry.genNumber}-${entry.name}-${index}` });
  });

  if (closed.length > 0) {
    out.push({ id: "divider-encerrados", isDivider: true, cohort: null });
    closed.forEach((entry, index) => {
      out.push({ ...entry, rank: null, id: `closed-${entry.cohort}-${entry.genNumber}-${entry.name}-${index}` });
    });
  }

  return out;
}
