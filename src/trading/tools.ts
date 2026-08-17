import { ulid } from "ulid";
import type { AutomatonTool, ToolContext } from "../types.js";
import type { PriceFeed } from "./feed.js";
import type { PaperSimulator } from "./simulator.js";
import type { OrderSide, TraderRow } from "./types.js";
import { loadBook, getTrader, updateTraderBalance, insertTrader, listTraders } from "./repo.js";
import { renderJournal, journalPath } from "./journal.js";

// Intern-hiring risk limits, enforced from ground truth (the DB book),
// never from agent-supplied args. Mirror spec §9.
const INTERN_HIRE_THRESHOLD_CENTS = 1000; // $10 — senior must reach this to hire
const INTERN_STAKE_MIN_CENTS = 200; //       $2 minimum stake
const LEADER_MIN_RETAIN_CENTS = 300; //      $3 the leader must retain post-stake
const MAX_INTERNS_PER_SENIOR = 1; //         cap on concurrent live interns

export function createTradingTools(
  sim: PaperSimulator,
  feed: PriceFeed,
): AutomatonTool[] {
  return [
    {
      name: "get_candles",
      description: "Fetch OHLCV candles from the price feed for a trading pair.",
      category: "financial",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading pair symbol, e.g. BTCUSDT" },
          interval: { type: "string", description: "Candle interval, e.g. 1m, 1h, 4h, 1d" },
          limit: { type: "number", description: "Number of candles (max 1000)" },
        },
        required: ["symbol"],
      },
      execute: async (args) => {
        const symbol = String(args.symbol);
        const interval = String(args.interval || "4h");
        const limit = Number(args.limit || 20);
        const candles = await feed.getCandles(symbol, interval, limit);
        return JSON.stringify(candles);
      },
    },
    {
      name: "get_price",
      description: "Fetch the latest ticker price in integer cents.",
      category: "financial",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Trading pair symbol, e.g. BTCUSDT" },
        },
        required: ["symbol"],
      },
      execute: async (args) => {
        const symbol = String(args.symbol);
        const priceCents = await feed.getPrice(symbol);
        return JSON.stringify({ symbol, priceCents });
      },
    },
    {
      name: "get_book",
      description: "Get trader cash balance, open positions, and total mark-to-market equity in cents.",
      category: "financial",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          traderId: { type: "string", description: "Trader ULID" },
        },
        required: ["traderId"],
      },
      execute: async (args, ctx) => {
        const traderId = String(args.traderId);
        const book = loadBook(ctx.db.raw, traderId);
        const equityCents = await sim.equityCents(traderId);
        return JSON.stringify({
          traderId,
          balanceCents: book.balanceCents,
          positions: book.positions,
          equityCents,
        });
      },
    },
    {
      name: "place_order",
      description: "Place a market buy or sell order in the paper simulator.",
      category: "financial",
      riskLevel: "dangerous",
      parameters: {
        type: "object",
        properties: {
          traderId: { type: "string", description: "Trader ULID" },
          symbol: { type: "string", description: "Asset symbol, e.g. BTCUSDT" },
          side: { type: "string", enum: ["buy", "sell"], description: "Order side" },
          qty: { type: "number", description: "Asset quantity" },
        },
        required: ["traderId", "symbol", "side", "qty"],
      },
      execute: async (args) => {
        const traderId = String(args.traderId);
        const symbol = String(args.symbol);
        const side = args.side as OrderSide;
        const qty = Number(args.qty);
        const res = await sim.placeOrder(traderId, symbol, side, qty);
        if (!res.ok) {
          return `Order rejected: ${res.error}`;
        }
        return `Order filled at ${res.priceCents} cents: ${side} ${qty} ${symbol}`;
      },
    },
    {
      name: "close_position",
      description: "Close an entire open position for a symbol by selling all holdings.",
      category: "financial",
      riskLevel: "dangerous",
      parameters: {
        type: "object",
        properties: {
          traderId: { type: "string", description: "Trader ULID" },
          symbol: { type: "string", description: "Asset symbol, e.g. BTCUSDT" },
        },
        required: ["traderId", "symbol"],
      },
      execute: async (args, ctx) => {
        const traderId = String(args.traderId);
        const symbol = String(args.symbol);
        const book = loadBook(ctx.db.raw, traderId);
        const pos = book.positions.find((p) => p.symbol === symbol);
        if (!pos || pos.qty <= 0) {
          return `No open position to close for ${symbol}`;
        }
        const res = await sim.placeOrder(traderId, symbol, "sell", pos.qty);
        if (!res.ok) {
          return `Close position failed: ${res.error}`;
        }
        return `Position closed at ${res.priceCents} cents: sold ${pos.qty} ${symbol}`;
      },
    },
    {
      name: "write_journal",
      description: "Record a post-trade reflection as a markdown file with YAML frontmatter.",
      category: "financial",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          traderId: { type: "string" },
          generation: { type: "number" },
          symbol: { type: "string" },
          side: { type: "string", enum: ["buy", "sell"] },
          entryCents: { type: "number" },
          exitCents: { type: "number" },
          sizeQty: { type: "number" },
          pnlCents: { type: "number" },
          thesis: { type: "string" },
          mistake: { type: "string" },
        },
        required: [
          "traderId",
          "generation",
          "symbol",
          "side",
          "entryCents",
          "exitCents",
          "sizeQty",
          "pnlCents",
          "thesis",
          "mistake",
        ],
      },
      execute: async (args, ctx) => {
        const now = new Date().toISOString();
        const entry = {
          traderId: String(args.traderId),
          generation: Number(args.generation),
          symbol: String(args.symbol),
          side: args.side as OrderSide,
          entryCents: Number(args.entryCents),
          exitCents: Number(args.exitCents),
          sizeQty: Number(args.sizeQty),
          pnlCents: Number(args.pnlCents),
          thesis: String(args.thesis),
          mistake: String(args.mistake),
        };
        const content = renderJournal(entry, now);
        const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
        const path = journalPath(home, entry.traderId, now);
        await ctx.conway.writeFile(path, content);
        return `Journal saved to ${path}`;
      },
    },
    {
      name: "hire_intern",
      description: "Senior trader stakes capital from their book to hire a new intern trader.",
      category: "financial",
      riskLevel: "dangerous",
      parameters: {
        type: "object",
        properties: {
          traderId: { type: "string", description: "Senior trader ULID" },
          name: { type: "string", description: "Name of new intern" },
          stakeCents: { type: "number", description: "Capital staked from senior's book" },
          strategySkill: { type: "string", description: "Path to inherited strategy SKILL.md" },
        },
        required: ["traderId", "name", "stakeCents"],
      },
      execute: async (args, ctx) => {
        const traderId = String(args.traderId);
        const stakeCents = Number(args.stakeCents);
        const name = String(args.name);
        const strategySkill = args.strategySkill ? String(args.strategySkill) : null;

        const leader = getTrader(ctx.db.raw, traderId);
        if (!leader || leader.status !== "live") {
          return `Error: Senior trader ${traderId} is not live.`;
        }
        if (leader.role !== "senior") {
          return `Error: Only senior traders can hire interns (${traderId} is ${leader.role}).`;
        }
        if (!Number.isFinite(stakeCents) || stakeCents <= 0) {
          return `Error: stakeCents must be a positive number.`;
        }
        // Ground-truth risk enforcement — balance from the book, never from args.
        if (leader.bookBalanceCents < INTERN_HIRE_THRESHOLD_CENTS) {
          return `Error: Balance ${leader.bookBalanceCents}c below hire threshold ${INTERN_HIRE_THRESHOLD_CENTS}c.`;
        }
        if (stakeCents < INTERN_STAKE_MIN_CENTS) {
          return `Error: Stake ${stakeCents}c below minimum ${INTERN_STAKE_MIN_CENTS}c.`;
        }
        if (leader.bookBalanceCents - stakeCents < LEADER_MIN_RETAIN_CENTS) {
          return `Error: Leader would retain ${leader.bookBalanceCents - stakeCents}c, below floor ${LEADER_MIN_RETAIN_CENTS}c.`;
        }
        const liveInterns = listTraders(ctx.db.raw, "live").filter(
          (t) => t.role === "intern" && t.parentId === traderId,
        );
        if (liveInterns.length >= MAX_INTERNS_PER_SENIOR) {
          return `Error: Senior ${traderId} already has ${liveInterns.length} live intern(s); cap is ${MAX_INTERNS_PER_SENIOR}.`;
        }

        const internId = ulid();
        const internRow: TraderRow = {
          id: internId,
          name,
          role: "intern",
          parentId: traderId,
          bookBalanceCents: stakeCents,
          status: "live",
          generation: leader.generation + 1,
          strategySkill,
          bornAt: new Date().toISOString(),
          diedAt: null,
          realizedPnlCents: 0,
        };

        const tx = ctx.db.raw.transaction(() => {
          updateTraderBalance(ctx.db.raw, traderId, leader.bookBalanceCents - stakeCents);
          insertTrader(ctx.db.raw, internRow);
        });
        tx();

        return JSON.stringify({
          ok: true,
          internId,
          name,
          role: "intern",
          stakeCents,
          generation: internRow.generation,
        });
      },
    },
  ];
}
