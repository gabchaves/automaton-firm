import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";
import type { PriceFeed } from "./feed.js";
import type { OrderSide } from "./types.js";
import { applyFill, markToMarketCents } from "./book.js";
import { loadBook, getTrader, updateTraderBalance, recordOrder, recordFill, syncPositions } from "./repo.js";

type DatabaseType = BetterSqlite3.Database;

export class PaperSimulator {
  constructor(
    private db: DatabaseType,
    private feed: PriceFeed,
  ) {}

  async placeOrder(
    traderId: string,
    symbol: string,
    side: OrderSide,
    qty: number,
  ): Promise<{ ok: boolean; priceCents?: number; error?: string }> {
    const trader = getTrader(this.db, traderId);
    if (!trader || trader.status !== "live") {
      return { ok: false, error: "trader not live" };
    }
    const priceCents = await this.feed.getPrice(symbol);
    const book = loadBook(this.db, traderId);
    try {
      const next = applyFill(book, { symbol, side, qty, priceCents });
      const orderId = ulid();
      const tx = this.db.transaction(() => {
        recordOrder(this.db, {
          id: orderId,
          traderId,
          symbol,
          side,
          size: qty,
          priceCents,
          status: "filled",
        });
        recordFill(this.db, {
          orderId,
          traderId,
          priceCents,
          qty,
        });
        updateTraderBalance(this.db, traderId, next.balanceCents);
        syncPositions(this.db, traderId, next.positions);
      });
      tx();
      return { ok: true, priceCents };
    } catch (err: any) {
      recordOrder(this.db, {
        id: ulid(),
        traderId,
        symbol,
        side,
        size: qty,
        priceCents,
        status: "rejected",
      });
      return { ok: false, error: err.message };
    }
  }

  async equityCents(traderId: string): Promise<number> {
    const book = loadBook(this.db, traderId);
    const prices: Record<string, number> = {};
    for (const p of book.positions) {
      prices[p.symbol] = await this.feed.getPrice(p.symbol);
    }
    return markToMarketCents(book, prices);
  }
}
