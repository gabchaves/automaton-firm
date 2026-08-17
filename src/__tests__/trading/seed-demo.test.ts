/**
 * Demo seeder (gated by SEED_DEMO=1). Populates a PERSISTENT demo DB with a
 * real firm tick — real Binance prices, real simulator fills, journals to disk
 * — using scripted per-trader decisions (the local 7b currently narrates
 * instead of trading; scripting the decisions here lets the dashboard show real
 * book activity now). Not a CI test.
 *
 *   SEED_DEMO=1 vitest run seed-demo
 */
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, getTrader } from "../../trading/repo.js";
import { runTraderTick } from "../../trading/tick-runner.js";
import { createBinanceFeed } from "../../trading/feed.js";
import { createLocalClient } from "../../conway/local-client.js";
import { createTestConfig, createTestIdentity } from "../mocks.js";

const SEED = process.env.SEED_DEMO === "1";

// Scripted brain: reads Trader ID from the system prompt, then buys a small
// position and journals it — so every trader produces a real order + journal.
class DemoScript {
  async chat(params: { messages: Array<{ role: string; content?: string }> }): Promise<{
    content: string;
    toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  }> {
    const sys = params.messages.find((m) => m.role === "system")?.content ?? "";
    const traderId = sys.match(/Trader ID: (\S+)/)?.[1] ?? "unknown";
    const turns = params.messages.filter((m) => m.role === "assistant").length;
    if (turns === 0) return { content: "price", toolCalls: [{ id: "a", function: { name: "get_price", arguments: JSON.stringify({ symbol: "BTCUSDT" }) } }] };
    if (turns === 1) return { content: "buy", toolCalls: [{ id: "b", function: { name: "place_order", arguments: JSON.stringify({ traderId, symbol: "BTCUSDT", side: "buy", qty: 0.00003 }) } }] };
    if (turns === 2) return { content: "journal", toolCalls: [{ id: "c", function: { name: "write_journal", arguments: JSON.stringify({ traderId, symbol: "BTCUSDT", side: "buy", entryCents: 6300000, exitCents: 0, sizeQty: 0.00003, pnlCents: 0, thesis: "Breakout above prior 3-candle high on BTCUSDT 4h.", mistake: "" }) } }] };
    return { content: "done", toolCalls: [{ id: "d", function: { name: "task_done", arguments: JSON.stringify({ summary: "Opened a small BTC long (a)." }) } }] };
  }
}

describe.skipIf(!SEED)("seed demo firm DB", () => {
  it("populates ~/.automaton/firm-demo.db with a real tick", async () => {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const dbPath = path.join(home, ".automaton", "firm-demo.db");
    const appDb = createDatabase(dbPath);

    // Three seniors with $100 books each.
    for (const id of ["alpha", "bravo", "charlie"]) {
      if (!getTrader(appDb.raw, id)) {
        insertTrader(appDb.raw, {
          id, name: id, role: "senior", parentId: null, bookBalanceCents: 10_000,
          status: "live", generation: 0, strategySkill: "strategy-base",
          bornAt: new Date().toISOString(), diedAt: null, realizedPnlCents: 0,
        });
      }
    }

    const conway = createLocalClient({ startingCents: 100_000, getSpentCents: () => 0, homeDir: home });
    const results = await runTraderTick({
      db: appDb,
      conway,
      config: createTestConfig(),
      identity: createTestIdentity(),
      inference: new DemoScript() as any,
      feed: createBinanceFeed(),
      workspaceRoot: path.join(home, ".automaton", "workspace"),
    });

    // eslint-disable-next-line no-console
    console.log("SEED RESULT:", JSON.stringify(results, null, 2));
    // eslint-disable-next-line no-console
    console.log("DB:", dbPath);
    expect(results.length).toBe(3);
    appDb.close();
  }, 120_000);
});
