import type BetterSqlite3 from "better-sqlite3";
import type { TraderRow } from "./types.js";
import { insertTrader, listTraders, setTraderStatus } from "./repo.js";
import type { HrAssessment } from "./hr-evaluation.js";

type DatabaseType = BetterSqlite3.Database;

export interface FirmConfig {
  seniorFloor: number;
  seniorStartCents: number;
  baseStrategySkill: string | null;
}

export function deathSweep(db: DatabaseType, at: string): string[] {
  const liveTraders = listTraders(db, "live");
  const deadIds: string[] = [];

  for (const trader of liveTraders) {
    if (trader.bookBalanceCents <= 0) {
      setTraderStatus(db, trader.id, "dead", at);
      deadIds.push(trader.id);
    }
  }

  return deadIds;
}

export function backfillSeniors(
  db: DatabaseType,
  cfg: FirmConfig,
  at: string,
  mkId: () => string,
): TraderRow[] {
  const liveSeniors = listTraders(db, "live").filter((t) => t.role === "senior");
  const added: TraderRow[] = [];
  let currentCount = liveSeniors.length;

  while (currentCount < cfg.seniorFloor) {
    const id = mkId();
    const newSenior: TraderRow = {
      id,
      name: `senior-${id.slice(0, 6)}`,
      role: "senior",
      parentId: null,
      bookBalanceCents: cfg.seniorStartCents,
      status: "live",
      generation: 0,
      strategySkill: cfg.baseStrategySkill,
      bornAt: at,
      diedAt: null,
      realizedPnlCents: 0,
    };
    insertTrader(db, newSenior);
    added.push(newSenior);
    currentCount++;
  }

  return added;
}

export function eligibleForPromotion(
  db: DatabaseType,
  metric: (id: string) => number,
): string | null {
  const liveInterns = listTraders(db, "live").filter((t) => t.role === "intern");
  if (liveInterns.length === 0) return null;

  const scored = liveInterns
    .map((i) => ({ id: i.id, score: metric(i.id) }))
    .filter((s) => Number.isFinite(s.score) && s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.id ?? null;
}

export function promoteTrader(db: DatabaseType, internId: string): void {
  db.prepare("UPDATE traders SET role = 'senior', parent_id = NULL WHERE id = ?").run(internId);
}

export function runPromotion(
  db: DatabaseType,
  cfg: FirmConfig,
  metric: (id: string) => number,
): string | null {
  const liveSeniors = listTraders(db, "live").filter((t) => t.role === "senior").length;
  if (liveSeniors >= cfg.seniorFloor) return null; // no open slot

  const interns = listTraders(db, "live").filter((t) => t.role === "intern");
  const scored = interns
    .map((i) => ({ id: i.id, score: metric(i.id) }))
    .filter((s) => Number.isFinite(s.score) && s.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.id ?? null;
  if (best) promoteTrader(db, best);
  return best;
}

/**
 * Evidence-gated promotion (additive — does not replace `runPromotion`).
 *
 * Only outperformers (judged against a random baseline on the same window,
 * see `./hr-evaluation.js`) are eligible for the open senior seat.
 * `insufficient_evidence` interns are surfaced via `skippedForEvidence` so
 * HR waiting for more evidence is observable, not silent — they are never
 * promoted, and this function never touches their status.
 */
export function runEvidencePromotion(
  db: DatabaseType,
  cfg: FirmConfig,
  assessments: HrAssessment[],
): { promoted: string | null; skippedForEvidence: string[] } {
  const liveSeniors = listTraders(db, "live").filter((t) => t.role === "senior").length;
  if (liveSeniors >= cfg.seniorFloor) return { promoted: null, skippedForEvidence: [] }; // no open slot

  const byId = new Map(assessments.map((a) => [a.traderId, a]));
  const liveInterns = listTraders(db, "live").filter((t) => t.role === "intern");

  const outperformers = liveInterns
    .map((t) => byId.get(t.id))
    .filter((a): a is HrAssessment => a !== undefined && a.verdict === "outperform")
    .sort((a, b) => b.excessCents - a.excessCents);

  const skippedForEvidence = liveInterns
    .map((t) => byId.get(t.id))
    .filter((a): a is HrAssessment => a !== undefined && a.verdict === "insufficient_evidence")
    .map((a) => a.traderId);

  const promoted = outperformers[0]?.traderId ?? null;
  if (promoted) promoteTrader(db, promoted);

  return { promoted, skippedForEvidence };
}

