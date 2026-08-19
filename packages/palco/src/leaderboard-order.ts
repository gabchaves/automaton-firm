import type { PalcoSnapshot } from "./types";

export type LeaderboardEntry = PalcoSnapshot["leaderboard"][number];

export interface RankedRow extends LeaderboardEntry {
  rank: number | null; // only live rows get a rank — see orderLeaderboardRows
  id: string;
}

export interface DividerRow {
  id: string;
  isDivider: true;
  cohort: string;
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
 * Cinto e suspensório (v4 plan, Task A3): dead/fired seats must never
 * outrank a live one, even when their book is higher — re-sorted here
 * explicitly on the client instead of trusting the backend's ordering to
 * survive every future change untested. Within each cohort (grouped in the
 * order cohorts first appear in `entries`, matching the backend's own
 * cohort grouping): live rows first (book desc), then fired (book desc),
 * then dead (book desc). A single divider marker is inserted right before
 * the first non-live row of a cohort section, only when that cohort
 * actually has one. Rank numbers (#1, #2, ...) are assigned only to live
 * rows, counted continuously across the whole ordered list.
 */
export function orderLeaderboardRows(entries: LeaderboardEntry[]): DisplayRow[] {
  const cohortOrder: string[] = [];
  for (const entry of entries) {
    if (!cohortOrder.includes(entry.cohort)) cohortOrder.push(entry.cohort);
  }

  const out: DisplayRow[] = [];
  let liveRank = 0;

  for (const cohort of cohortOrder) {
    const cohortEntries = entries
      .filter((entry) => entry.cohort === cohort)
      .slice()
      .sort((a, b) => {
        const priorityDiff = (STATUS_PRIORITY[a.status] ?? 1) - (STATUS_PRIORITY[b.status] ?? 1);
        return priorityDiff !== 0 ? priorityDiff : b.bookMc - a.bookMc;
      });

    let dividerInserted = false;
    cohortEntries.forEach((entry, index) => {
      if (!dividerInserted && entry.status !== "live") {
        out.push({ id: `divider-${cohort}`, isDivider: true, cohort });
        dividerInserted = true;
      }

      const isLive = entry.status === "live";
      if (isLive) liveRank += 1;
      out.push({
        ...entry,
        rank: isLive ? liveRank : null,
        id: `${cohort}-${entry.genNumber}-${entry.name}-${index}`,
      });
    });
  }

  return out;
}
