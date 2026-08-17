/**
 * Trader tick runner.
 *
 * Drives one TradingHarness decision cycle per live trader. This is the
 * integration the heartbeat `trader_tick` task delegates to — extracted here
 * so it can be unit-tested with a scripted inference client and a stub feed
 * (see firm-dry-run integration test for the same wiring).
 *
 * Dependencies are injected so production wires a real inference client +
 * Binance feed, while tests inject deterministic ones.
 */
import path from "node:path";
import { createLogger } from "../observability/logger.js";
import { PaperSimulator } from "./simulator.js";
import { createTradingTools } from "./tools.js";
import { listTraders } from "./repo.js";
import type { PriceFeed } from "./feed.js";
import { TradingHarness } from "../agent/harnesses/trading-harness.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { SpendTracker } from "../agent/spend-tracker.js";
import { createDefaultRules } from "../agent/policy-rules/index.js";
import { AgentWorkspace } from "../orchestration/workspace.js";
import type { HarnessContext, WorkerInferenceClient } from "../agent/harness-types.js";
import type {
  AutomatonConfig,
  AutomatonDatabase,
  AutomatonIdentity,
  ConwayClient,
} from "../types.js";

const logger = createLogger("trading.tick-runner");

const DEFAULT_SYMBOL = "BTCUSDT";
const DEFAULT_MAX_TURNS = 8;
const DEFAULT_TIMEOUT_MS = 120_000;
const TICK_GOAL_ID = "firm";

export interface TraderTickDeps {
  db: AutomatonDatabase;
  conway: ConwayClient;
  config: AutomatonConfig;
  identity: AutomatonIdentity;
  inference: WorkerInferenceClient;
  feed: PriceFeed;
  symbol?: string;
  maxTurns?: number;
  workspaceRoot?: string;
}

export interface TraderTickResult {
  traderId: string;
  ok: boolean;
  output?: string;
  error?: string;
}

/**
 * Run one decision cycle for every live trader. A failure in one trader is
 * isolated — it is recorded and the tick continues with the next trader.
 */
export async function runTraderTick(deps: TraderTickDeps): Promise<TraderTickResult[]> {
  const symbol = deps.symbol ?? DEFAULT_SYMBOL;
  const maxTurns = deps.maxTurns ?? DEFAULT_MAX_TURNS;
  const home = deps.workspaceRoot
    ?? path.join(process.env.HOME || process.env.USERPROFILE || process.cwd(), ".automaton", "workspace");

  const live = listTraders(deps.db.raw, "live");
  logger.info(`trader_tick driving ${live.length} live traders on ${symbol}`);

  // A single simulator + tool set is shared across traders in this tick;
  // per-trader isolation comes from the traderId passed in each tool call.
  const sim = new PaperSimulator(deps.db.raw, deps.feed);
  const tradingTools = createTradingTools(sim, deps.feed);
  const policyEngine = new PolicyEngine(deps.db.raw, createDefaultRules(deps.config.treasuryPolicy));
  const spendTracker = new SpendTracker(deps.db.raw);

  const results: TraderTickResult[] = [];

  for (const trader of live) {
    const workspace = new AgentWorkspace(TICK_GOAL_ID, path.join(home, "firm", trader.id));
    const context: HarnessContext = {
      workspaceRoot: workspace.basePath,
      allowedEditRoot: home,
      workspace,
      identity: deps.identity,
      config: deps.config,
      db: deps.db.raw,
      conway: deps.conway,
      inference: deps.inference,
      budget: {
        maxTurns,
        maxCostCents: 100,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        turnsUsed: 0,
        costUsedCents: 0,
        startedAt: 0,
      },
      wisdom: { conventions: [], successes: [], failures: [], gotchas: [] },
      abortSignal: new AbortController().signal,
      goalId: TICK_GOAL_ID,
      toolCatalog: tradingTools,
      toolContext: {
        identity: deps.identity,
        config: deps.config,
        db: deps.db,
        conway: deps.conway,
        inference: {
          chat: async () => {
            throw new Error("ToolContext inference is not used by trading tools");
          },
          setLowComputeMode: () => {},
          getDefaultModel: () => "trader-tick",
        },
      },
      policyEngine,
      spendTracker,
    };

    const harness = new TradingHarness();
    try {
      await harness.initialize(
        {
          id: `tick-${trader.id}`,
          parentId: null,
          goalId: TICK_GOAL_ID,
          title: `Trading tick for ${trader.name}`,
          description: `Run one swing-trading decision cycle on ${symbol}.`,
          status: "assigned",
          assignedTo: trader.id,
          agentRole: "trader",
          priority: 50,
          dependencies: [],
          result: null,
          metadata: {
            estimatedCostCents: 5,
            actualCostCents: 0,
            maxRetries: 0,
            retryCount: 0,
            timeoutMs: DEFAULT_TIMEOUT_MS,
            createdAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
          },
        },
        context,
      );
      const result = await harness.execute();
      results.push({ traderId: trader.id, ok: result.success, output: result.output });
      logger.info(`trader ${trader.id} tick ${result.success ? "ok" : "failed"}: ${result.output.slice(0, 120)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ traderId: trader.id, ok: false, error: message });
      logger.error(`trader ${trader.id} tick threw: ${message}`);
    }
  }

  return results;
}
