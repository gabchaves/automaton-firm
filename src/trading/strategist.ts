import fs from "node:fs";
import path from "node:path";
import type { WorkerInferenceClient } from "../agent/harness-types.js";
import type { JournalSummary } from "./journal-aggregate.js";
import type { BacktestResult } from "./backtest.js";

export interface StrategyDraft {
  name: string;
  path: string;
  content: string;
}

export async function formulateStrategy(deps: {
  inference: WorkerInferenceClient;
  generation: number;
  priorStrategy: string;
  summary: JournalSummary;
  priorPerformance: BacktestResult;
  homeDir?: string;
}): Promise<StrategyDraft> {
  const name = `strategy-gen${deps.generation}`;
  const home = deps.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();

  const prompt = [
    `You are the CEO and Head of Quantitative Strategy of an autonomous trading firm.`,
    `Your mission is to formulate the next generation trading strategy (${name}) based on real post-trade journals and performance data from Generation ${deps.generation - 1}.`,
    ``,
    `## Incumbent Strategy (${deps.priorPerformance.strategySkill})`,
    deps.priorStrategy,
    ``,
    `## Last Generation Performance`,
    `- Total Trades: ${deps.summary.totalTrades} (${deps.summary.winCount} Wins / ${deps.summary.lossCount} Losses, ${(deps.summary.winRate * 100).toFixed(1)}% Win Rate)`,
    `- Realized PnL: $${(deps.priorPerformance.realizedPnlCents / 100).toFixed(2)} (${deps.priorPerformance.realizedPnlCents} cents)`,
    `- Max Drawdown: $${(deps.priorPerformance.maxDrawdownCents / 100).toFixed(2)} (${deps.priorPerformance.maxDrawdownCents} cents)`,
    `- Final Equity: $${(deps.priorPerformance.finalEquityCents / 100).toFixed(2)} (${deps.priorPerformance.finalEquityCents} cents)`,
    ``,
    `## Top Recurring Mistakes & Lessons Identified by Traders:`,
    deps.summary.mistakes.length > 0
      ? deps.summary.mistakes.map((m) => `- [${m.count}x] ${m.mistake}`).join("\n")
      : "- (No specific mistakes recorded)",
    ``,
    `## Recent Trader Theses:`,
    deps.summary.theses.length > 0
      ? deps.summary.theses.slice(-5).map((t) => `- "${t}"`).join("\n")
      : "- (No theses recorded)",
    ``,
    `## Instructions`,
    `Write a revised, complete, actionable strategy document for Generation ${deps.generation}.`,
    `Specifically fix the recurring mistakes and preserve what worked.`,
    `Include explicit Entry, Exit (take-profit and stop-loss), Sizing, and Discipline rules.`,
    `Output ONLY the strategy markdown.`,
  ].join("\n");

  const response = await deps.inference.chat({
    tier: "reasoning",
    messages: [
      {
        role: "system",
        content: "You are the quantitative trading CEO. Output clean strategy markdown.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  let content = response.content?.trim() || "";

  // Ensure YAML frontmatter exists
  if (!content.startsWith("---")) {
    const frontmatter = [
      "---",
      `name: ${name}`,
      `description: "CEO-evolved strategy, generation ${deps.generation}"`,
      "auto-activate: true",
      "---",
      "",
    ].join("\n");
    content = `${frontmatter}${content}`;
  }

  const skillDir = path.join(home, ".automaton", "skills", name);
  fs.mkdirSync(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(skillPath, content, "utf-8");

  return {
    name,
    path: skillPath,
    content,
  };
}
