import type { CarryGenerationRecord } from "./evolve-carry.js";
import { type CarryArchetype, CARRY_ARCHETYPES } from "./carry-archetypes.js";

export function archetypesFromLineage(
  records: CarryGenerationRecord[],
  topN = 3,
): CarryArchetype[] {
  const sorted = [...records].sort(
    (a, b) => (b.evalResult?.realizedPnlCents ?? 0) - (a.evalResult?.realizedPnlCents ?? 0),
  );

  const out: CarryArchetype[] = [];
  for (let i = 0; i < Math.min(topN, sorted.length); i++) {
    const r = sorted[i];
    out.push({
      name: r.strategySkill,
      params: r.params,
    });
  }

  // Pad with defaults if fewer than topN
  let padIdx = 0;
  while (out.length < topN) {
    const fallback = CARRY_ARCHETYPES[padIdx % CARRY_ARCHETYPES.length];
    out.push(fallback);
    padIdx++;
  }

  return out;
}
