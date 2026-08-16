import type BetterSqlite3 from "better-sqlite3";
import type { TraderRow } from "./types.js";
import { insertTrader, listTraders, setTraderStatus } from "./repo.js";

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

  const scored = liveInterns.map((i) => ({ id: i.id, score: metric(i.id) }));
  scored.sort((a, b) => b.score - a.score);

  return scored[0]?.id ?? null;
}
