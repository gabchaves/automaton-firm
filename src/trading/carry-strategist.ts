import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { WorkerInferenceClient } from "../agent/harness-types.js";
import type { CarryParams, CarryResult } from "./carry-types.js";
import { CARRY_PARAMS_SCHEMA } from "./carry-params.js";

export interface CarryDraft {
  name: string;
  params: CarryParams;
  rationale: string;
  path: string;
}

const CEO_OUTPUT_SCHEMA = CARRY_PARAMS_SCHEMA.extend({ rationale: z.string().min(1) });

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const body = fenced ? fenced[1] : start >= 0 && end > start ? text.slice(start, end + 1) : "";
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export async function formulateCarryStrategy(deps: {
  inference: WorkerInferenceClient;
  generation: number;
  priorParams: CarryParams;
  priorResult: CarryResult;
  homeDir?: string;
}): Promise<CarryDraft> {
  const name = `carry-gen${deps.generation}`;
  const home = deps.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  const lostCycles = deps.priorResult.cycles.reduce((n, c) => n + (c.netCents < 0 ? 1 : 0), 0);

  const prompt = [
    `You are the CEO and Head of Quant of an autonomous trading firm running a`,
    `delta-neutral funding carry (long spot + short perp, collecting perp funding).`,
    `Design generation ${deps.generation}'s rule set to earn more NET funding`,
    `out-of-sample than the incumbent, WITHOUT churning: each entry+exit pays ~30 bps`,
    `of notional in taker fees, so short holds lose money.`,
    ``,
    `## Incumbent params`,
    JSON.stringify(deps.priorParams, null, 2),
    ``,
    `## Incumbent performance (train window)`,
    `- Net PnL: $${(deps.priorResult.realizedPnlCents / 100).toFixed(2)}`,
    `- Funding collected: $${(deps.priorResult.fundingCollectedCents / 100).toFixed(2)}`,
    `- Fees paid: $${(deps.priorResult.feesPaidCents / 100).toFixed(2)}`,
    `- Cycles: ${deps.priorResult.closedTrades} (${lostCycles} lost money)`,
    `- Max drawdown: $${(deps.priorResult.maxDrawdownCents / 100).toFixed(2)}`,
    ``,
    `## Engine rules (you tune TIMING only; position size is fixed by the firm)`,
    `- enterFundingBps: enter when funding (bps/8h) >= this`,
    `- exitFundingBps: exit when funding <= this (keep enter > exit for hysteresis)`,
    `- maxHoldBars: hard cap on funding intervals held (8h each)`,
    `- minBarsBetweenTrades: cooldown bars between cycles (raise to cut churn)`,
    ``,
    `## Output`,
    `Return ONLY a JSON object with keys enterFundingBps, exitFundingBps, maxHoldBars,`,
    `minBarsBetweenTrades, and rationale (a short string explaining the change vs the`,
    `incumbent). No prose outside the JSON.`,
  ].join("\n");

  const response = await deps.inference.chat({
    tier: "reasoning",
    messages: [
      { role: "system", content: "You are a quantitative trading CEO. Output only JSON." },
      { role: "user", content: prompt },
    ],
  });

  const parsed = CEO_OUTPUT_SCHEMA.safeParse(extractJson(response.content ?? ""));
  let params: CarryParams;
  let rationale: string;
  if (parsed.success) {
    const { rationale: r, ...rest } = parsed.data;
    params = rest;
    rationale = r;
  } else {
    params = deps.priorParams;
    rationale = `[fallback] CEO output invalid (${parsed.error.issues[0]?.message ?? "no JSON"}); kept incumbent params.`;
  }

  const skillDir = path.join(home, ".automaton", "skills", name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "params.json"), JSON.stringify(params, null, 2), "utf-8");
  const md = [
    "---",
    `name: ${name}`,
    `description: "CEO-evolved funding-carry params, generation ${deps.generation}"`,
    "---",
    "",
    `# ${name}`,
    "",
    "```json",
    JSON.stringify(params, null, 2),
    "```",
    "",
    "## Rationale",
    "",
    rationale,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), md, "utf-8");

  return { name, params, rationale, path: skillDir };
}
