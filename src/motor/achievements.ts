/**
 * Deduplicated achievement rules over the Motor's event stream.
 *
 * Every rule is a pure function of the current cohort runtime plus the
 * event drafts `stepCohortBar` just produced this bar — no DB writes here,
 * only reads (`db.hasAchievement`) to keep each achievement one-time per
 * trader. Callers persist the returned drafts via `emitEvents`.
 */

import { traderEquityMc, TRADER_START_MC } from "./cohort.js";
import type { CohortRuntime, TraderRuntime } from "./cohort.js";
import type { MotorDb } from "./db.js";
import type { MotorEventDraft } from "./events.js";

export const ACHIEVEMENT_LABELS = {
  first_trade: "Primeiro trade",
  first_profit: "Primeiro lucro",
  survived_7d: "Sobreviveu 7 dias",
  survived_30d: "Sobreviveu 30 dias",
  beat_benchmark: "Bateu o benchmark na revisão", // emitted by HR (Task 8), label lives here
  plus_10pct: "+10% no book",
  died_day1: "Morreu no primeiro dia",
} as const;
export type AchievementKey = keyof typeof ACHIEVEMENT_LABELS;

const ONE_DAY_MS = 86_400_000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;
const PLUS_10PCT_THRESHOLD_MC = Math.round(1.1 * TRADER_START_MC);

interface AchievementCandidate {
  traderId: string;
  name: string;
  key: AchievementKey;
}

function tradersById(runtime: CohortRuntime): Map<string, TraderRuntime> {
  return new Map(runtime.traders.map((t) => [t.id, t]));
}

/** Rules keyed off what just happened this bar (trade opens/closes, deaths). */
function fromStepEvents(runtime: CohortRuntime, stepEvents: MotorEventDraft[]): AchievementCandidate[] {
  const byId = tradersById(runtime);
  const candidates: AchievementCandidate[] = [];

  for (const ev of stepEvents) {
    const trader = ev.traderId ? byId.get(ev.traderId) : undefined;
    if (!trader) continue;

    if (ev.type === "trade_opened") {
      candidates.push({ traderId: trader.id, name: trader.name, key: "first_trade" });
      continue;
    }

    if (ev.type === "trade_closed") {
      const payload = ev.payload as { realizedPnlMc: number };
      if (payload.realizedPnlMc > 0) {
        candidates.push({ traderId: trader.id, name: trader.name, key: "first_profit" });
      }
      continue;
    }

    if (ev.type === "trader_died") {
      const payload = ev.payload as { ageMs: number };
      if (payload.ageMs < ONE_DAY_MS) {
        candidates.push({ traderId: trader.id, name: trader.name, key: "died_day1" });
      }
    }
  }

  return candidates;
}

/** Rules keyed off the trader's current live state (age, equity). */
function fromLiveState(
  runtime: CohortRuntime,
  ts: number,
  closeBySymbol: Map<string, number>,
): AchievementCandidate[] {
  const candidates: AchievementCandidate[] = [];

  for (const t of runtime.traders) {
    if (t.status !== "live") continue;

    const ageMs = ts - t.bornAt;
    if (ageMs >= THIRTY_DAYS_MS) candidates.push({ traderId: t.id, name: t.name, key: "survived_30d" });
    if (ageMs >= SEVEN_DAYS_MS) candidates.push({ traderId: t.id, name: t.name, key: "survived_7d" });

    if (traderEquityMc(t, closeBySymbol) >= PLUS_10PCT_THRESHOLD_MC) {
      candidates.push({ traderId: t.id, name: t.name, key: "plus_10pct" });
    }
  }

  return candidates;
}

export function evaluateAchievements(deps: {
  db: MotorDb;
  runtime: CohortRuntime;
  ts: number;
  closeBySymbol: Map<string, number>;
  stepEvents: MotorEventDraft[]; // the drafts stepCohortBar just produced
}): MotorEventDraft[] {
  const { db, runtime, ts, closeBySymbol, stepEvents } = deps;

  const candidates = [
    ...fromStepEvents(runtime, stepEvents),
    ...fromLiveState(runtime, ts, closeBySymbol),
  ];

  const seen = new Set<string>();
  const events: MotorEventDraft[] = [];

  for (const c of candidates) {
    const dedupeKey = `${c.traderId}:${c.key}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (db.hasAchievement(c.traderId, c.key)) continue;

    events.push({
      ts, type: "achievement", traderId: c.traderId, generationId: runtime.generationId,
      payload: { key: c.key, name: c.name, label: ACHIEVEMENT_LABELS[c.key] },
    });
  }

  return events;
}
