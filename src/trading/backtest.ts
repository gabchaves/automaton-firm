import type {
  AutomatonConfig,
  AutomatonDatabase,
  AutomatonIdentity,
  ConwayClient,
} from "../types.js";
import type { WorkerInferenceClient } from "../agent/harness-types.js";
import type { ReplayFeed } from "./replay-feed.js";
import { runTraderTick } from "./tick-runner.js";
import { PaperSimulator } from "./simulator.js";
import { getTrader, insertTrader } from "./repo.js";
import { closedTradeCount } from "./metrics.js";

export interface BacktestResult {
  traderId: string;
  strategySkill: string;
  ticks: number;
  finalEquityCents: number;
  realizedPnlCents: number;
  closedTrades: number;
  maxDrawdownCents: number;
}

export async function runBacktest(deps: {
  db: AutomatonDatabase;
  conway: ConwayClient;
  config: AutomatonConfig;
  identity: AutomatonIdentity;
  inference: WorkerInferenceClient;
  replay: ReplayFeed;
  traderId: string;
  strategySkill: string;
  startCents: number;
  symbol?: string;
}): Promise<BacktestResult> {
  const symbol = deps.symbol ?? "BTCUSDT";

  // Ensure trader is registered in the database
  const existing = getTrader(deps.db.raw, deps.traderId);
  if (!existing) {
    insertTrader(deps.db.raw, {
      id: deps.traderId,
      name: deps.traderId,
      role: "senior",
      parentId: null,
      bookBalanceCents: deps.startCents,
      status: "live",
      generation: 0,
      strategySkill: deps.strategySkill,
      bornAt: new Date().toISOString(),
      diedAt: null,
      realizedPnlCents: 0,
    });
  }

  const sim = new PaperSimulator(deps.db.raw, deps.replay.feed);
  let ticks = 0;
  let peakEquity = deps.startCents;
  let maxDrawdownCents = 0;

  while (true) {
    // Record pre-tick equity
    const equity = await sim.equityCents(deps.traderId);
    if (equity > peakEquity) peakEquity = equity;
    const drawdown = peakEquity - equity;
    if (drawdown > maxDrawdownCents) maxDrawdownCents = drawdown;

    // Run tick decision
    await runTraderTick({
      db: deps.db,
      conway: deps.conway,
      config: deps.config,
      identity: deps.identity,
      inference: deps.inference,
      feed: deps.replay.feed,
      symbol,
    });
    ticks++;

    // Advance feed or finish
    const hasMore = deps.replay.advance();
    if (!hasMore) {
      break;
    }
  }

  // Final equity after replay window
  const finalEquityCents = await sim.equityCents(deps.traderId);
  if (finalEquityCents > peakEquity) peakEquity = finalEquityCents;
  const finalDrawdown = peakEquity - finalEquityCents;
  if (finalDrawdown > maxDrawdownCents) maxDrawdownCents = finalDrawdown;

  const trader = getTrader(deps.db.raw, deps.traderId);
  const closedTrades = closedTradeCount(deps.db.raw, deps.traderId);

  return {
    traderId: deps.traderId,
    strategySkill: deps.strategySkill,
    ticks,
    finalEquityCents,
    realizedPnlCents: trader?.realizedPnlCents ?? 0,
    closedTrades,
    maxDrawdownCents,
  };
}
