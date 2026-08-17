import type { JournalEntry } from "./journal.js";

export interface JournalSummary {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnlCents: number;
  mistakes: Array<{ mistake: string; count: number }>;
  theses: string[];
}

export function aggregateJournals(entries: JournalEntry[]): JournalSummary {
  let winCount = 0;
  let lossCount = 0;
  let totalPnlCents = 0;
  const mistakeCounts: Record<string, number> = {};
  const theses: string[] = [];

  for (const e of entries) {
    totalPnlCents += e.pnlCents;
    if (e.pnlCents > 0) winCount++;
    else if (e.pnlCents < 0) lossCount++;

    if (e.thesis && e.thesis.trim().length > 0) {
      theses.push(e.thesis.trim());
    }

    if (
      e.mistake &&
      e.mistake.trim().length > 0 &&
      e.mistake.trim().toLowerCase() !== "none"
    ) {
      const m = e.mistake.trim();
      mistakeCounts[m] = (mistakeCounts[m] ?? 0) + 1;
    }
  }

  const mistakes = Object.entries(mistakeCounts)
    .map(([mistake, count]) => ({ mistake, count }))
    .sort((a, b) => b.count - a.count);

  const totalTrades = entries.length;
  const winRate = totalTrades > 0 ? winCount / totalTrades : 0;

  return {
    totalTrades,
    winCount,
    lossCount,
    winRate,
    totalPnlCents,
    mistakes,
    theses,
  };
}
