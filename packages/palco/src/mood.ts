/**
 * Mood emoji for a trader, from status + current book vs. the starting
 * stake. Per the v3 plan's fun-pass addendum: cosmetic only, never derived
 * from anything but real snapshot fields (status, bookMc) and the stake
 * scale (bookMc's own currency unit, not a hardcoded dollar figure).
 *
 * `STAKE_MC` mirrors `src/motor/cohort.ts`'s `TRADER_START_MC` ($200.00 per
 * hired trader) — same mirroring rule as `types.ts` (packages/palco is a
 * standalone workspace, no cross-package import into `src/motor/`). It's
 * only the FALLBACK used when a caller has no live snapshot yet — every
 * real render should pass `snapshot.cards.traderStartMc` as `stakeMc`
 * instead, so a bankroll scale change never touches this file's callers.
 *
 * Shared by the Leaderboard, the Pregão positions panel, and the Empresa
 * graph nodes (leva B) — kept dependency-free so any of those can import it.
 */
export const STAKE_MC = 20_000_000; // $200.00, mirrors TRADER_START_MC

const MOOD_DEAD = "💀";
const MOOD_FIRED = "📦";
const MOOD_GREAT = "😎"; // book >= 105% of stake
const MOOD_NORMAL = "🙂"; // 100-105% of stake
const MOOD_UNEASY = "😬"; // 95-100% of stake
const MOOD_BAD = "😰"; // < 95% of stake

const GREAT_RATIO = 1.05;
const NORMAL_RATIO = 1.0;
const UNEASY_RATIO = 0.95;

export function moodEmoji(status: string, bookMc: number, stakeMc: number = STAKE_MC): string {
  if (status === "dead") return MOOD_DEAD;
  if (status === "fired") return MOOD_FIRED;

  const ratio = bookMc / stakeMc;
  if (ratio >= GREAT_RATIO) return MOOD_GREAT;
  if (ratio >= NORMAL_RATIO) return MOOD_NORMAL;
  if (ratio >= UNEASY_RATIO) return MOOD_UNEASY;
  return MOOD_BAD;
}
