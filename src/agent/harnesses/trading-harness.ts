import { BaseHarness } from "./base-harness.js";
import type { HarnessTool } from "../harness-types.js";
import { toolsForRole } from "../tool-profiles.js";
import { getTrader, loadBook } from "../../trading/repo.js";
import { loadStrategySkill } from "../../trading/strategy.js";
import { executeTool } from "../tools.js";
import { sanitizeToolResult } from "../injection-defense.js";
import type { SpendTrackerInterface } from "../../types.js";

const NOOP_SPEND_TRACKER: SpendTrackerInterface = {
  recordSpend: () => {},
  getHourlySpend: () => 0,
  getDailySpend: () => 0,
  getTotalSpend: () => 0,
  checkLimit: () => ({
    allowed: true,
    currentHourlySpend: 0,
    currentDailySpend: 0,
    limitHourly: Number.MAX_SAFE_INTEGER,
    limitDaily: Number.MAX_SAFE_INTEGER,
  }),
  pruneOldRecords: () => 0,
};

export class TradingHarness extends BaseHarness {
  readonly id = "trader";
  readonly description = "Paper-trading agent for systematic crypto book management, trade execution, and journal logging.";

  private textOnlyNudges = 0;

  protected override onTextOnlyResponse(): { continue: boolean; nudge?: string } {
    if (this.textOnlyNudges >= 2) return { continue: false }; // give up after 2 nudges; tick ends
    this.textOnlyNudges++;
    return {
      continue: true,
      nudge:
        "You responded with analysis but took no action. You MUST call a tool now — " +
        "place_order or close_position to trade, or task_done with an explicit HOLD " +
        "decision and the exact price that would trigger you. Do not reply with plain text.",
    };
  }

  buildSystemPrompt(): string {
    const traderId =
      (this.task?.assignedTo as string | undefined) ??
      ((this.task as any)?.params?.traderId as string | undefined) ??
      this.task?.id ??
      "trader-default";

    let bookInfo = "No active book found.";
    let role = "senior";
    let strategy = "";

    if (this.context?.db) {
      const trader = getTrader(this.context.db, traderId);
      if (trader) {
        role = trader.role;
        const skillBody = loadStrategySkill(trader.strategySkill);
        strategy = skillBody
          ? `\n\n## Your Strategy (${trader.strategySkill})\n${skillBody}`
          : (trader.strategySkill ? `\n\n## Strategy Skill\n${trader.strategySkill}` : "");
        const book = loadBook(this.context.db, traderId);
        bookInfo = `Cash Balance: $${(book.balanceCents / 100).toFixed(2)} (${book.balanceCents} cents)\nPositions: ${JSON.stringify(book.positions)}`;
      }
    }

    return `You are an autonomous paper trader with role: ${role}.
Trader ID: ${traderId}

## Current Book State
${bookInfo}${strategy}

## Your Decision This Tick
You MUST reach one explicit decision before calling task_done:
  (a) OPEN a position with place_order, or
  (b) CLOSE/adjust an existing position with close_position, or
  (c) HOLD — deliberately take no trade.
A tick that only analyzes is a failure. If you do not trade, you must state
the specific price condition that would make you trade next.

## Workflow
1. get_book — know your cash and open positions.
2. get_signals + get_candles + get_price — read quantitative indicators and price action on BTCUSDT.
3. Form a one-sentence thesis citing specific indicator values (direction + why).
4. Act: place_order or close_position, sized within your book. Oversized
   orders are rejected by the system — size conservatively.
5. write_journal after any closed trade (thesis, outcome, mistake).
6. task_done with a summary that names the decision you made (a/b/c).`;
  }

  getToolDefs(): HarnessTool[] {
    const taskDoneTool: HarnessTool = {
      name: "task_done",
      description: "Signal that you have completed your trading tick analysis and actions.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Summary of trading decisions and actions taken" },
        },
        required: ["summary"],
      },
      execute: async (args) => {
        return `Task completed: ${args.summary}`;
      },
    };

    const catalog = this.context.toolCatalog ?? [];
    const traderCatalogTools = toolsForRole("trader", catalog);
    const wrappedCatalogTools: HarnessTool[] = traderCatalogTools.flatMap((t) => {
      if (t.name === "task_done") return [];
      return [
        {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          execute: async (args) => {
            if (!this.context.toolContext) {
              return `Error: Tool context is unavailable for '${t.name}'`;
            }

            const result = await executeTool(
              t.name,
              args,
              catalog,
              this.context.toolContext,
              this.context.policyEngine,
              {
                inputSource: "system",
                turnToolCallCount: 0,
                sessionSpend: this.context.spendTracker ?? NOOP_SPEND_TRACKER,
              },
            );

            if (result.error) {
              return `Error: ${result.error}`;
            }
            return sanitizeToolResult(result.result);
          },
        },
      ];
    });

    return [taskDoneTool, ...wrappedCatalogTools];
  }
}
