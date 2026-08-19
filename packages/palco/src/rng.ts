/**
 * Deterministic seeded-randomness utilities for the Mural's cosmetic
 * reactions and avatar hues. `mulberry32` is copied verbatim from
 * `src/trading/deciders.ts` (same algorithm, same constants) — this
 * package is a standalone Vite workspace with its own tsconfig, so a
 * cross-package import into `src/trading/` is not wired, same reasoning
 * as the `types.ts` mirror. Global Constraint: reactions/avatars are
 * seeded, NEVER `Math.random`.
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return function rng(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** djb2 string hash -> unsigned 32-bit int. Turns a name into a mulberry32 seed. */
export function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

/** Deterministic hue (0-359) for an avatar background, seeded from a name. */
export function hueForName(name: string): number {
  const rng = mulberry32(hashString(name));
  return Math.floor(rng() * 360);
}

export interface ReactionCounts {
  clap: number;
  fire: number;
  sad: number | null; // null = this post type never shows the 😢 reaction
}

const REACTION_MAX = 40;

/**
 * Seeded, non-interactive reaction counts for a Mural post. Pure function
 * of `seed` (the underlying event id) so the same post always renders the
 * same counts across renders/reconnects — no state, no Math.random.
 * `includeSad` gates the 😢 reaction, which per the plan only appears on
 * trader_fired/trader_died posts.
 */
export function seededReactions(seed: number, includeSad: boolean): ReactionCounts {
  const rng = mulberry32(seed >>> 0);
  const clap = Math.floor(rng() * (REACTION_MAX + 1));
  const fire = Math.floor(rng() * (REACTION_MAX + 1));
  const sad = includeSad ? Math.floor(rng() * (REACTION_MAX + 1)) : null;
  return { clap, fire, sad };
}

const KARMA_MAX = 999;

/**
 * Deterministic decorative "karma" score shown next to a Mural post's
 * author name (v4 plan's Task B2 Orkut escalation) — seeded the same way
 * as `seededReactions` (the underlying feed event id), via its OWN
 * `mulberry32` instance so it never shares draws with the reactions rng.
 * Same event, same karma, forever; purely decorative, no real reputation
 * system backs this number (same "never fake DATA" rule as the joke
 * communities box and the visitor counter).
 */
export function seededKarma(seed: number): number {
  const rng = mulberry32(seed >>> 0);
  return 1 + Math.floor(rng() * KARMA_MAX);
}

/**
 * Deterministically shuffles `names` (Fisher-Yates over a COPY — the input
 * array is never mutated) and returns the first `count` — used by the
 * Mural's "visitas recentes" decorative line (v4 Task B2) to pick 2-3 names
 * "pulled from known traders" without ever touching `Math.random`. Pure
 * function of `seed`, so the same roster + seed always yields the same
 * displayed visitors across renders/reconnects.
 */
export function seededPick<T>(items: T[], count: number, seed: number): T[] {
  const rng = mulberry32(seed >>> 0);
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.max(0, Math.min(count, shuffled.length)));
}
