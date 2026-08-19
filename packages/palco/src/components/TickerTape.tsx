import { Marquee } from "./Marquee";
import type { PalcoSnapshot } from "../types";
import { usd } from "../format";

type FeedItem = PalcoSnapshot["feed"][number];

export interface TickerItem {
  key: string;
  text: string;
  cls: "pos" | "neg";
}

// Keeps a very long session's feed from turning the loop into a marathon —
// the ticker only ever needs "latest trades", not the full history.
const MAX_TICKER_ITEMS = 14;

/** "BTCUSDT" -> "BTC" — Binance's USDT-margined symbols all share this
 * suffix, and dropping it is what makes the ticker read like a real stock
 * tape ("BTC ▲ +$0.42") instead of a raw API symbol. */
function shortSymbol(symbol: string): string {
  const stripped = symbol.replace(/USDT$/, "");
  return stripped.length > 0 ? stripped : symbol;
}

/** Pure trade-feed -> ticker-tape text mapper, split out from the component
 * for direct unit testing (same "logic file next to its component" split
 * as mural-posts.ts/MuralTab.tsx). Every `trade_closed` item becomes one
 * tape entry — unlike the Mural, the ticker has no small-trade threshold;
 * it's a raw tape of what actually happened, newest first (feed order). */
export function buildTickerItems(feed: FeedItem[]): TickerItem[] {
  const items: TickerItem[] = [];
  for (const item of feed) {
    if (item.type !== "trade_closed") continue;
    const pnlRaw = item.payload.realizedPnlMc;
    const pnl = typeof pnlRaw === "number" ? pnlRaw : 0;
    const symbolRaw = item.payload.symbol;
    const symbol = typeof symbolRaw === "string" ? symbolRaw : "?";
    const isWin = pnl >= 0;
    const arrow = isWin ? "▲" : "▼";
    const sign = isWin ? "+" : "−";
    items.push({
      key: `ticker-${item.id}`,
      text: `${shortSymbol(symbol)} ${arrow} ${sign}${usd(Math.abs(pnl))}`,
      cls: isWin ? "pos" : "neg",
    });
    if (items.length >= MAX_TICKER_ITEMS) break;
  }
  return items;
}

const EMPTY_MESSAGE = "aguardando o pregão…";

interface TickerTapeProps {
  feed: FeedItem[];
}

/**
 * Slim stock-ticker strip, directly under the nav (v3.2 plan, Commit 1):
 * the latest `trade_closed` events scrolling via Marquee, green/red by
 * pnl. Falls back to a static "aguardando o pregão…" line — never an empty
 * bar, never a Marquee looping over nothing — when there's no trade yet.
 */
export function TickerTape({ feed }: TickerTapeProps) {
  const items = buildTickerItems(feed);

  return (
    <div className="border-y border-[color:var(--border-color-fade)] bg-black font-mono text-[11px] text-lightgrey">
      {items.length === 0 ? (
        <p className="m-0 px-4 py-2 italic">{EMPTY_MESSAGE}</p>
      ) : (
        <Marquee className="py-2">
          {items.map((item) => (
            <span key={item.key} className={item.cls === "pos" ? "text-terminal" : "text-red"}>
              · {item.text}
            </span>
          ))}
        </Marquee>
      )}
    </div>
  );
}
