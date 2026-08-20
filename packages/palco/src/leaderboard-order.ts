import type { PalcoSnapshot } from "./types";

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

// Explicit tiers within a cohort: vivo=0, demitido=1, morto=2. The backend's
// `computeLeaderboard` (src/motor/palco-data.ts) already orders by
// `cohort, status != 'live', book_mc DESC`, but that boolean comparison
// treats fired and dead as the same tier — this re-sorts with the finer
// tiering the Leaderboard tab actually wants.
const STATUS_PRIORITY: Record<string, number> = { live: 0, fired: 1, dead: 2 };

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
 */
export function orderLeaderboardRows(entries: LeaderboardEntry[]): DisplayRow[] {
  const cohortOrder: string[] = [];
  for (const entry of entries) {
    if (!cohortOrder.includes(entry.cohort)) cohortOrder.push(entry.cohort);
  }

  const out: DisplayRow[] = [];
  let liveRank = 0;

  for (const cohort of cohortOrder) {
    const liveEntries = entries
      .filter((entry) => entry.cohort === cohort && entry.status === "live")
      .slice()
      .sort((a, b) => b.bookMc - a.bookMc);

    liveEntries.forEach((entry, index) => {
      liveRank += 1;
      out.push({ ...entry, rank: liveRank, id: `${cohort}-live-${entry.genNumber}-${entry.name}-${index}` });
    });
  }

  const closedEntries = entries
    .filter((entry) => entry.status !== "live")
    .slice()
    .sort((a, b) => {
      const priorityDiff = (STATUS_PRIORITY[a.status] ?? 1) - (STATUS_PRIORITY[b.status] ?? 1);
      return priorityDiff !== 0 ? priorityDiff : b.bookMc - a.bookMc;
    });

  if (closedEntries.length > 0) {
    out.push({ id: "divider-encerrados", isDivider: true, cohort: null });
    closedEntries.forEach((entry, index) => {
      out.push({ ...entry, rank: null, id: `closed-${entry.cohort}-${entry.genNumber}-${entry.name}-${index}` });
    });
  }

  return out;
}
