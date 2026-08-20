/**
 * Pure post-building logic for the Mural: turns raw feed items (event type
 * + payload) into social-post view models. Kept separate from MuralTab.tsx
 * so the headline/body/grouping rules are testable and readable on their
 * own — no React here.
 *
 * ALL text is plain strings meant for React text interpolation (auto
 * escaped) — the only exception is `fallbackHtml`, a last-resort escape
 * hatch for event types this module doesn't model, which reuses the
 * server's already-escaped `html` field (see palco-format.ts).
 *
 * v3.2 plan ("mural humanizado"): body copy for every modeled event type is
 * picked deterministically from muralVoice.ts's joke pools, seeded from
 * `mulberry32(item.id)` — same event, same joke, forever. Headlines/emojis
 * are untouched by that pass; they're still decided right here.
 */
import type { PalcoSnapshot } from "../types";
import type { Employee } from "../lineage";
import { usd } from "../format";
import { mulberry32 } from "../rng";
import { pickBody, signedUsd } from "../muralVoice";
import { cargoForEmployee } from "../cargo";

// Exported so MuralTab.tsx can type the older pages it fetches from
// GET /api/feed (v4.2 Task 2b) without re-deriving the same shape.
export type FeedItem = PalcoSnapshot["feed"][number];

type LeaderboardEntry = PalcoSnapshot["leaderboard"][number];

/**
 * Real cargo (job title) for a trader-authored post — same computation
 * Empresa's roster/drawer already use (cargo.ts's cargoForEmployee), so a
 * post says the same thing about someone that their own profile does,
 * instead of a generic "Trader" placeholder.
 *
 * Returns null when the trader can't be resolved: `employees` only covers
 * the CURRENT (unended) generation's roster (see palco-data.ts), so a post
 * from an older, already-ended generation legitimately has no match here —
 * callers fall back to a generic cargo in that case, never a crash or a
 * fabricated title.
 */
function cargoTituloFor(name: string, employees: Employee[], leaderboard: LeaderboardEntry[]): string | null {
  const employee = employees.find((e) => e.name === name);
  if (!employee) return null;
  const leaderboardEntry = leaderboard.find((entry) => entry.traderId === employee.traderId) ?? null;
  return cargoForEmployee(employee, leaderboardEntry).titulo;
}

export interface MuralAuthor {
  name: string;
  cargo: string;
}

export interface MuralPost {
  key: string;
  ts: number;
  memberIds: number[]; // underlying feed item id(s) this post represents — for fade-highlight
  author: MuralAuthor;
  headline: string;
  body: string;
  quoted?: string;
  reactionSeed: number;
  includeSad: boolean;
  fallbackHtml?: string;
  // Set only for an ungrouped (i.e. "big") trade_closed post — small trades
  // never reach buildEventPost, they're folded into the per-symbol "resumo
  // da mesa" group instead. Drives the retro post box's green/red left-
  // border accent.
  pnlClass?: "pos" | "neg";
}

// Individual trade_closed posts only survive above this bar — 2% of the
// generation's starting bankroll (v4 plan's "even less frequent, more
// Orkut" pass, raised from the v3.2 plan's 1%, itself raised from the v3
// plan's flat $0.05). Everything smaller folds into one grouped "resumo da
// mesa {symbol}" post per symbol per render instead of flooding the wall.
// Scale-derived: at the Motor's current 100_000_000 genStartMc that's
// $20.00; the threshold moves automatically with any bankroll change.
const DEFAULT_GEN_START_MC = 100_000_000; // sane fallback, mirrors palco-data.ts's GEN_START_MC
const SMALL_TRADE_DIVISOR = 50;

function num(payload: Record<string, unknown>, key: string, fallback = 0): number {
  const value = payload[key];
  return typeof value === "number" ? value : fallback;
}

function str(payload: Record<string, unknown>, key: string, fallback = ""): string {
  const value = payload[key];
  return typeof value === "string" ? value : fallback;
}

function symbolOf(item: FeedItem): string {
  return str(item.payload, "symbol", "?");
}

function isSmallTrade(item: FeedItem, thresholdMc: number): boolean {
  return Math.abs(num(item.payload, "realizedPnlMc")) < thresholdMc;
}

/** hr_review posts only render when the cycle actually DID something —
 * a review with zero firings/promotions is noise, per the v3.2 plan. */
function hasHrActions(payload: Record<string, unknown>): boolean {
  return num(payload, "fired") + num(payload, "promoted") > 0;
}

function groupedTradeBody(count: number, netPnlMc: number): string {
  const countLabel = count === 1 ? "1 operação miúda" : `${count} operações miúdas`;
  const saldo = signedUsd(netPnlMc);
  return netPnlMc >= 0
    ? `${countLabel}, saldo ${saldo}. Formiguinha também é lucro.`
    : `${countLabel}, saldo ${saldo}. A corretora agradece as taxas.`;
}

/** Real trader identity for a grouped small-trade post — same resolution
 * as buildEventPost's individual trade_closed case. Falls back to the
 * old symbol-as-persona framing only when traderName is missing (an event
 * that predates palco-data.ts's traderName enrichment), never fabricating
 * a name. */
function groupAuthorFor(
  item: FeedItem,
  symbol: string,
  employees: Employee[],
  leaderboard: LeaderboardEntry[],
): MuralAuthor {
  const traderName = str(item.payload, "traderName", "");
  if (!traderName) return { name: symbol, cargo: `Trader · Mesa ${symbol}` };
  return { name: traderName, cargo: cargoTituloFor(traderName, employees, leaderboard) ?? "Trader" };
}

/** Mutable accumulator for one TRADER's small-trade "resumo" post — grouped
 * by trader, not by mesa/symbol: a mesa can have several traders sharing
 * the same symbol, and posing as "SOLUSDT the trader" isn't a real person
 * (user feedback: every post should read like it's from someone on the
 * firm's own social network, not a ticker). Each trader trades one fixed
 * symbol for their whole lifetime, so grouping by trader never mixes
 * symbols within a post. The `post` object is pushed into the result array
 * ONCE, then mutated in place as more of that trader's small trades turn up
 * anywhere else in the feed (not just consecutively) — "one post per
 * trader per render". */
interface GroupAccumulator {
  post: MuralPost;
  count: number;
  netPnlMc: number;
}

function startGroupedTrade(
  item: FeedItem,
  groupKey: string,
  employees: Employee[],
  leaderboard: LeaderboardEntry[],
): GroupAccumulator {
  const netPnlMc = num(item.payload, "realizedPnlMc");
  const symbol = symbolOf(item);
  const acc: GroupAccumulator = {
    count: 1,
    netPnlMc,
    post: {
      key: `group-${groupKey}-${item.id}`,
      ts: item.ts, // feed is newest-first, so the FIRST small trade of this trader encountered is the most recent
      memberIds: [item.id],
      author: groupAuthorFor(item, symbol, employees, leaderboard),
      headline: "🔁 Balanço do dia",
      body: "",
      reactionSeed: item.id,
      includeSad: false,
    },
  };
  acc.post.body = groupedTradeBody(acc.count, acc.netPnlMc);
  return acc;
}

function addToGroupedTrade(acc: GroupAccumulator, item: FeedItem): void {
  acc.count += 1;
  acc.netPnlMc += num(item.payload, "realizedPnlMc");
  acc.post.memberIds.push(item.id);
  acc.post.body = groupedTradeBody(acc.count, acc.netPnlMc);
}

function buildEventPost(item: FeedItem, employees: Employee[], leaderboard: LeaderboardEntry[]): MuralPost {
  const p = item.payload;
  const rng = mulberry32(item.id);
  const base = { key: `event-${item.id}`, ts: item.ts, memberIds: [item.id], reactionSeed: item.id };

  switch (item.type) {
    case "trade_closed": {
      const pnl = num(p, "realizedPnlMc");
      const symbol = symbolOf(item);
      const win = pnl > 0;
      // traderName comes from palco-data.ts's LEFT JOIN (trade_closed's own
      // payload only ever carries symbol/price/pnl, never who traded it) —
      // absent for events older than this enrichment, or a resolution
      // edge case, so both the name and cargo fall back to the symbol.
      const traderName = str(p, "traderName", "");
      const name = traderName || symbol;
      const cargo = traderName ? cargoTituloFor(traderName, employees, leaderboard) : null;
      return {
        ...base,
        author: { name, cargo: cargo ?? `Trader · Mesa ${symbol}` },
        headline: win ? "📈 Lucro em destaque" : "📉 Perda no book",
        body: pickBody("trade_closed", p, rng),
        includeSad: false,
        pnlClass: win ? "pos" : "neg",
      };
    }
    case "trader_hired": {
      const name = str(p, "name", "Novo trader");
      return {
        ...base,
        author: { name, cargo: cargoTituloFor(name, employees, leaderboard) ?? "Trader" },
        headline: "🤝 Nova contratação",
        body: pickBody("trader_hired", p, rng),
        includeSad: false,
      };
    }
    case "trader_fired": {
      const name = str(p, "name", "Trader");
      return {
        ...base,
        author: { name: "RH", cargo: "RH" },
        headline: "📦 Desligamento",
        body: pickBody("trader_fired", p, rng),
        quoted: str(p, "reason"),
        includeSad: true,
      };
    }
    case "trader_rotated": {
      return {
        ...base,
        author: { name: "RH", cargo: "RH" },
        headline: "🔄 Rotação de cadeira",
        body: pickBody("trader_rotated", p, rng),
        quoted: str(p, "reason"),
        includeSad: false,
      };
    }
    case "trader_died": {
      const name = str(p, "name", "Trader");
      return {
        ...base,
        author: { name, cargo: cargoTituloFor(name, employees, leaderboard) ?? "Trader" },
        headline: "🕯️ Nota de falecimento (do book)",
        body: pickBody("trader_died", p, rng),
        includeSad: true,
      };
    }
    case "trader_promoted": {
      const name = str(p, "name", "Trader");
      return {
        ...base,
        author: { name, cargo: cargoTituloFor(name, employees, leaderboard) ?? "Trader" },
        headline: "🏆 Promoção",
        body: pickBody("trader_promoted", p, rng),
        includeSad: false,
      };
    }
    case "achievement": {
      const name = str(p, "name", "Trader");
      return {
        ...base,
        author: { name, cargo: cargoTituloFor(name, employees, leaderboard) ?? "Trader" },
        headline: "✨ Conquista desbloqueada",
        body: pickBody("achievement", p, rng),
        includeSad: false,
      };
    }
    case "record_broken": {
      return {
        ...base,
        author: { name: "A Firma", cargo: "A Firma" },
        headline: "🔔 Recorde da firma",
        body: pickBody("record_broken", p, rng),
        includeSad: false,
      };
    }
    case "gen_started": {
      return {
        ...base,
        author: { name: "A Firma", cargo: "A Firma" },
        headline: "🌱 Comunicado da diretoria",
        body: pickBody("gen_started", p, rng),
        includeSad: false,
      };
    }
    case "gen_ended": {
      return {
        ...base,
        author: { name: "A Firma", cargo: "A Firma" },
        headline: "⚰️ Comunicado da diretoria",
        body: pickBody("gen_ended", p, rng),
        includeSad: false,
      };
    }
    case "hr_review": {
      return {
        ...base,
        author: { name: "RH", cargo: "RH" },
        headline: "🧾 Ciclo de avaliação",
        body: pickBody("hr_review", p, rng),
        includeSad: false,
      };
    }
    default: {
      // Last-resort fallback for an event type this UI doesn't model as a
      // structured social post (e.g. catch_up, gap). Safe: item.html is
      // produced server-side by formatEventPt, which escapes every payload
      // value through escapeHtml before interpolation.
      return {
        ...base,
        author: { name: "A Firma", cargo: "A Firma" },
        headline: "📋 Atualização",
        body: "",
        fallbackHtml: item.html,
        includeSad: false,
      };
    }
  }
}

/**
 * Turns the raw feed into Mural posts (v3.2 plan's "less frequent" pass):
 * - `trade_opened` never becomes a post — it stays visible in the Pregão
 *   trades list and the ticker-tape, but the Mural doesn't need an "opened
 *   a position" scrap for every trade.
 * - `trade_closed` posts individually only when |pnl| >= 2% of `genStartMc`
 *   (see `DEFAULT_GEN_START_MC`/`SMALL_TRADE_DIVISOR` above); smaller ones
 *   fold into one "balanço do dia" post per TRADER (v4.7: was per symbol —
 *   a mesa can have several traders sharing it, and posing as "SOLUSDT the
 *   trader" isn't a real person), aggregated across the WHOLE rendered feed
 *   (not just consecutive entries).
 * - `hr_review` posts only when the cycle actually fired or promoted
 *   someone; a quiet review (0 actions) is skipped entirely.
 * - Every other event type maps 1:1 to its own post, same as before.
 *
 * `genStartMc` defaults to `DEFAULT_GEN_START_MC` so callers that haven't
 * loaded a snapshot yet (or existing call sites) still get a sane
 * threshold; MuralTab.tsx passes the live `snapshot.cards.genStartMc`.
 *
 * `employees`/`leaderboard` (both default to []) resolve a real cargo
 * (job title) for trader-authored posts via cargoTituloFor — same values
 * MuralTab.tsx already reads for its "visitas recentes" line and passes
 * straight from `snapshot.org.employees`/`snapshot.leaderboard`.
 */
export function buildMuralPosts(
  feed: FeedItem[],
  genStartMc: number = DEFAULT_GEN_START_MC,
  employees: Employee[] = [],
  leaderboard: LeaderboardEntry[] = [],
): MuralPost[] {
  const smallTradeThresholdMc = genStartMc / SMALL_TRADE_DIVISOR;
  const posts: MuralPost[] = [];
  const groupsByTrader = new Map<string, GroupAccumulator>();

  for (const item of feed) {
    if (item.type === "trade_opened") continue;
    if (item.type === "hr_review" && !hasHrActions(item.payload)) continue;

    if (item.type === "trade_closed" && isSmallTrade(item, smallTradeThresholdMc)) {
      // traderName groups by the real person; falling back to symbol only
      // for pre-enrichment events that never got a traderName at all.
      const groupKey = str(item.payload, "traderName", "") || symbolOf(item);
      const existing = groupsByTrader.get(groupKey);
      if (existing) {
        addToGroupedTrade(existing, item);
      } else {
        const acc = startGroupedTrade(item, groupKey, employees, leaderboard);
        groupsByTrader.set(groupKey, acc);
        posts.push(acc.post);
      }
      continue;
    }

    posts.push(buildEventPost(item, employees, leaderboard));
  }

  return posts;
}
