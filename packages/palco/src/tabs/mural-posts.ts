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
 */
import type { PalcoSnapshot } from "../types";
import { usd } from "../format";

type FeedItem = PalcoSnapshot["feed"][number];

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
}

// Trades grouped into one "Resumo da mesa" post when |pnl| is below this —
// $0.05, per the plan.
const SMALL_TRADE_THRESHOLD_MC = 5_000;

function num(payload: Record<string, unknown>, key: string, fallback = 0): number {
  const value = payload[key];
  return typeof value === "number" ? value : fallback;
}

function str(payload: Record<string, unknown>, key: string, fallback = ""): string {
  const value = payload[key];
  return typeof value === "string" ? value : fallback;
}

function cohortLabel(cohort: string): string {
  return cohort === "evolved" ? "firma" : "controle";
}

function symbolOf(item: FeedItem): string {
  return str(item.payload, "symbol", "?");
}

/** trade_opened has no pnl concept (it's the entry, not the exit) so it
 * always groups; trade_closed groups only below the small-trade threshold —
 * a big win or a big loss stays its own spotlight post. */
function isSmallTrade(item: FeedItem): boolean {
  if (item.type === "trade_opened") return true;
  if (item.type === "trade_closed") return Math.abs(num(item.payload, "realizedPnlMc")) < SMALL_TRADE_THRESHOLD_MC;
  return false;
}

function buildGroupedTradePost(items: FeedItem[]): MuralPost {
  const symbol = symbolOf(items[0]);
  const count = items.length;
  const netPnlMc = items.reduce(
    (sum, item) => (item.type === "trade_closed" ? sum + num(item.payload, "realizedPnlMc") : sum),
    0,
  );
  const firstId = items[0].id;
  const lastId = items[items.length - 1].id;

  return {
    key: `group-${firstId}-${lastId}`,
    ts: items[0].ts, // feed is newest-first, so items[0] is the most recent member
    memberIds: items.map((item) => item.id),
    author: { name: symbol, cargo: `Trader · Mesa ${symbol}` },
    headline: "🔁 Resumo da mesa",
    body: `A mesa de ${symbol} girou ${count} ${count === 1 ? "trade pequeno" : "trades pequenos"}, líquido ${usd(netPnlMc)}.`,
    reactionSeed: firstId,
    includeSad: false,
  };
}

function buildEventPost(item: FeedItem): MuralPost {
  const p = item.payload;
  const base = { key: `event-${item.id}`, ts: item.ts, memberIds: [item.id], reactionSeed: item.id };

  switch (item.type) {
    case "trade_closed": {
      const pnl = num(p, "realizedPnlMc");
      const symbol = symbolOf(item);
      const win = pnl > 0;
      const liquidatedNote = p.liquidated === true ? " A posição foi liquidada." : "";
      return {
        ...base,
        author: { name: symbol, cargo: `Trader · Mesa ${symbol}` },
        headline: win ? "📈 Lucro em destaque" : "📉 Perda no book",
        body: win
          ? `Fechamos ${symbol} com lucro de ${usd(pnl)}. 🎉`
          : `Fechamos ${symbol} com perda de ${usd(Math.abs(pnl))}.${liquidatedNote}`,
        includeSad: false,
      };
    }
    case "trader_hired": {
      const name = str(p, "name", "Novo trader");
      return {
        ...base,
        author: { name, cargo: "Trader" },
        headline: "🤝 Nova contratação",
        body: `Demos as boas-vindas a ${name} na mesa (slot ${num(p, "slot")}), com stake inicial de ${usd(num(p, "stakeMc"))}.`,
        includeSad: false,
      };
    }
    case "trader_fired": {
      const name = str(p, "name", "Trader");
      return {
        ...base,
        author: { name: "RH", cargo: "RH" },
        headline: "📦 Desligamento",
        body: `Hoje encerramos o ciclo de ${name} na firma. Devolveu ${usd(num(p, "returnedMc"))} ao caixa. Desejamos sorte na próxima geração.`,
        quoted: str(p, "reason"),
        includeSad: true,
      };
    }
    case "trader_died": {
      const name = str(p, "name", "Trader");
      const ageH = (num(p, "ageMs") / 3_600_000).toFixed(1);
      return {
        ...base,
        author: { name, cargo: "Trader" },
        headline: "🕯️ Nota de falecimento (do book)",
        body: `${name} chegou ao fim depois de ${ageH}h de operação, com pico de book em ${usd(num(p, "bookPeakMc"))}.`,
        includeSad: true,
      };
    }
    case "trader_promoted": {
      const name = str(p, "name", "Trader");
      return {
        ...base,
        author: { name, cargo: "Trader" },
        headline: "🏆 Promoção",
        body: `${name} foi promovido(a) para ${str(p, "title")}.`,
        includeSad: false,
      };
    }
    case "achievement": {
      const name = str(p, "name", "Trader");
      return {
        ...base,
        author: { name, cargo: "Trader" },
        headline: "✨ Conquista desbloqueada",
        body: `${name} desbloqueou uma conquista: "${str(p, "label")}".`,
        includeSad: false,
      };
    }
    case "record_broken": {
      return {
        ...base,
        author: { name: "A Firma", cargo: "A Firma" },
        headline: "🔔 Recorde da firma",
        body: `Novo recorde: ${usd(num(p, "peakEquityMc"))} (${cohortLabel(str(p, "cohort"))}, geração ${num(p, "genNumber")}) — recorde anterior era ${usd(num(p, "previousRecordMc"))}.`,
        includeSad: false,
      };
    }
    case "gen_started": {
      return {
        ...base,
        author: { name: "A Firma", cargo: "A Firma" },
        headline: "🌱 Comunicado da diretoria",
        body: `Geração ${num(p, "genNumber")} (${cohortLabel(str(p, "cohort"))}) começou. ${str(p, "seedNote")}`,
        includeSad: false,
      };
    }
    case "gen_ended": {
      const recordNote = p.isNewRecord === true ? " 🔔 Novo recorde!" : "";
      return {
        ...base,
        author: { name: "A Firma", cargo: "A Firma" },
        headline: "⚰️ Comunicado da diretoria",
        body: `Geração ${num(p, "genNumber")} (${cohortLabel(str(p, "cohort"))}) encerrou depois de ${num(p, "daysLived")} dias, com pico de ${usd(num(p, "peakEquityMc"))}.${recordNote}`,
        includeSad: false,
      };
    }
    case "hr_review": {
      return {
        ...base,
        author: { name: "RH", cargo: "RH" },
        headline: "🧾 Ciclo de avaliação",
        body: `Ciclo de avaliação: ${num(p, "reviewed")} avaliados, ${num(p, "fired")} demitidos, ${num(p, "promoted")} promovidos, ${num(p, "held")} mantidos.`,
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

/** Groups consecutive small trades (same symbol) into one post, and maps
 * every other feed item 1:1 to its own post. Feed is newest-first. */
export function buildMuralPosts(feed: FeedItem[]): MuralPost[] {
  const posts: MuralPost[] = [];
  let i = 0;
  while (i < feed.length) {
    const item = feed[i];
    if (isSmallTrade(item)) {
      const symbol = symbolOf(item);
      const group: FeedItem[] = [];
      while (i < feed.length && isSmallTrade(feed[i]) && symbolOf(feed[i]) === symbol) {
        group.push(feed[i]);
        i += 1;
      }
      posts.push(buildGroupedTradePost(group));
    } else {
      posts.push(buildEventPost(item));
      i += 1;
    }
  }
  return posts;
}
