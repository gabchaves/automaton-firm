/**
 * Shared cohort/status ordering contract — the algorithm behind BOTH the
 * Leaderboard table (`leaderboard-order.ts`) and Empresa's roster list
 * (`tabs/EmpresaRoster.tsx`, v4.3 plan). Extracted here instead of
 * duplicated because the two source shapes (`LeaderboardEntry` vs.
 * `org.employees`'s `Employee`) don't line up field-for-field — this only
 * captures the subset that DOES line up (cohort/status/bookMc), leaving
 * rank assignment, id generation, and the visual divider entirely to each
 * caller.
 *
 * The contract itself (v4.1 fix, ported unchanged): live rows first,
 * grouped by cohort in the order cohorts first appear in the input and
 * sorted book-desc within each cohort group; THEN every CLOSED (non-live)
 * row from every cohort together — fired before dead, book-desc within each
 * tier — at the true end of the whole list, not just the end of its own
 * cohort's block. See `leaderboard-order.test.ts`'s adversarial regression:
 * a closed seat from cohort A must never outrank a live seat from cohort B.
 */
export interface StatusCohortRow {
  cohort: string;
  status: string;
  bookMc: number;
}

// Explicit tiers within the closed group: vivo=0 (never appears here),
// demitido=1, morto=2 — finer than a plain "status != 'live'" boolean.
const STATUS_PRIORITY: Record<string, number> = { live: 0, fired: 1, dead: 2 };

export interface OrderedByStatus<T> {
  live: T[];
  closed: T[];
}

export function orderRowsByStatus<T extends StatusCohortRow>(entries: T[]): OrderedByStatus<T> {
  const cohortOrder: string[] = [];
  for (const entry of entries) {
    if (!cohortOrder.includes(entry.cohort)) cohortOrder.push(entry.cohort);
  }

  const live: T[] = [];
  for (const cohort of cohortOrder) {
    const liveInCohort = entries
      .filter((entry) => entry.cohort === cohort && entry.status === "live")
      .slice()
      .sort((a, b) => b.bookMc - a.bookMc);
    live.push(...liveInCohort);
  }

  const closed = entries
    .filter((entry) => entry.status !== "live")
    .slice()
    .sort((a, b) => {
      const priorityDiff = (STATUS_PRIORITY[a.status] ?? 1) - (STATUS_PRIORITY[b.status] ?? 1);
      return priorityDiff !== 0 ? priorityDiff : b.bookMc - a.bookMc;
    });

  return { live, closed };
}
