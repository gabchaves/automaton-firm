/**
 * LLM executive agents (CEO / HR / CFO) for the llm-governed cohort — see
 * docs/superpowers/specs/2026-08-20-motor-executive-agents-design.md.
 *
 * Every decision point is journal-or-call: check `db.getLlmDecision` first
 * (pure, synchronous); only a cache miss calls the LLM. This is what lets
 * tick.ts resolve these decisions in an async pre-step BEFORE its
 * synchronous db.tx() (better-sqlite3 transactions cannot await), and what
 * makes replaying an already-processed historical window free — a NEW
 * window is the only thing that ever spends real inference cost.
 *
 * Every role has a safe, fully-deterministic FALLBACK it uses whenever the
 * LLM is unreachable, its response fails schema validation, or the spend
 * cap is already exhausted — the cohort never crashes or stalls because of
 * an LLM problem, it just falls back to the least intervention-y default
 * for that role (hold everyone / deploy fully / no mutation bias).
 *
 * Pricing note: fal.ai bills the user's account directly — this app's own
 * ProviderRegistry has costPerInputToken/costPerOutputToken configured as 0
 * for this provider (it isn't tracked by the internal credit ledger at
 * all), so SpendCap computes real USD from token usage using fal's published
 * OpenRouter rate for google/gemini-3-flash-preview, not the SDK's own cost
 * field.
 */

import { z } from "zod";
import { ProviderRegistry } from "../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../inference/inference-client.js";
import type { UnifiedInferenceResult } from "../inference/inference-client.js";
import { mutateGenome, makeGene, SIGNAL_FAMILIES } from "../trading/genome.js";
import type { Genome, SignalGeneFamily } from "../trading/genome.js";
import { mulberry32 } from "../trading/deciders.js";
import { hashSeed } from "./cohort.js";
import type { MotorDb, LlmRole } from "./db.js";
import type { HrAssessment, HrDecision } from "../trading/hr-evaluation.js";

/** Only `.chat()` is used anywhere in this file — narrowed so tests can
 * inject a plain scripted mock instead of a real ProviderRegistry-backed
 * client, the same pattern createWorkerInferenceBridge already uses. */
export type ChatClient = Pick<UnifiedInferenceClient, "chat">;

const INPUT_PRICE_PER_MILLION_USD = 0.5;
const OUTPUT_PRICE_PER_MILLION_USD = 3.0;

function estimateCostUsd(usage: { inputTokens: number; outputTokens: number }): number {
  return (
    (usage.inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION_USD +
    (usage.outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION_USD
  );
}

export class SpendCapExceededError extends Error {}

export class SpendCap {
  private spentUsdInternal = 0;

  constructor(private readonly limitUsd: number) {}

  get spentUsd(): number {
    return this.spentUsdInternal;
  }

  get exhausted(): boolean {
    return this.spentUsdInternal >= this.limitUsd;
  }

  /** Records spend AFTER a call (cost is only known post-response). Never
   * throws — the caller checks `.exhausted` BEFORE the next call to decide
   * whether to skip it; this only tracks the running total. */
  record(usage: { inputTokens: number; outputTokens: number }): number {
    const cost = estimateCostUsd(usage);
    this.spentUsdInternal += cost;
    return cost;
  }
}

export function createLlmClient(providerConfigPath: string): UnifiedInferenceClient {
  return new UnifiedInferenceClient(ProviderRegistry.fromConfig(providerConfigPath));
}

/**
 * True only when the config file resolves a provider/model for the
 * "reasoning" tier — the capability check tick.ts uses to decide whether the
 * llm-governed cohort exists at all (never a feature flag; see the design
 * spec's non-goals). This does NOT confirm the provider's API key is
 * actually set — that can only fail at call time, which
 * `resolveJournaledDecision` already handles by falling back safely. This
 * only rules out the coarse case: no config file, or no reasoning-tier
 * provider in it at all.
 */
export function isLlmAvailable(providerConfigPath: string): boolean {
  try {
    ProviderRegistry.fromConfig(providerConfigPath).resolveModel("reasoning");
    return true;
  } catch {
    return false;
  }
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

async function resolveJournaledDecision<T>(opts: {
  db: MotorDb;
  genNumber: number;
  ts: number;
  role: LlmRole;
  schema: z.ZodType<T>;
  buildMessages: () => ChatMessage[];
  maxTokens: number;
  client: ChatClient;
  spendCap: SpendCap;
  fallback: T;
  log?: (line: string) => void;
}): Promise<T> {
  const { db, genNumber, ts, role, schema, buildMessages, maxTokens, client, spendCap, fallback } = opts;
  const log = opts.log ?? (() => {});

  const cached = db.getLlmDecision(genNumber, ts, role);
  if (cached) {
    const parsed = schema.safeParse(JSON.parse(cached.decisionJson));
    if (parsed.success) return parsed.data;
    log(`llm-agents: journaled ${role} decision at (${genNumber}, ${ts}) failed schema re-validation, using fallback`);
    return fallback;
  }

  if (spendCap.exhausted) {
    log(`llm-agents: spend cap exhausted ($${spendCap.spentUsd.toFixed(4)}), skipping ${role} call, using fallback`);
    return fallback;
  }

  let response: UnifiedInferenceResult;
  try {
    response = await client.chat({
      tier: "reasoning",
      messages: buildMessages(),
      maxTokens,
      temperature: 0.4,
      responseFormat: { type: "json_object" },
    });
  } catch (err) {
    log(`llm-agents: ${role} inference call failed (${err instanceof Error ? err.message : String(err)}), using fallback`);
    return fallback;
  }

  const costUsd = spendCap.record(response.usage);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(response.content);
  } catch {
    log(`llm-agents: ${role} response was not valid JSON, using fallback`);
    return fallback;
  }

  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    log(`llm-agents: ${role} response failed schema validation, using fallback`);
    return fallback;
  }

  db.insertLlmDecision({
    genNumber, ts, role,
    decisionJson: JSON.stringify(parsed.data),
    rawResponse: response.content,
    providerId: response.metadata.providerId,
    modelId: response.metadata.modelId,
    costCredits: costUsd,
    createdAt: Date.now(),
  });

  return parsed.data;
}

// ---------------------------------------------------------------------------
// HR director
// ---------------------------------------------------------------------------

const HR_MAX_OUTPUT_TOKENS = 200;

const HrLlmDecisionSchema = z.object({
  promote: z.array(z.string()),
  retire: z.array(z.string()),
  hold: z.array(z.string()),
});

function buildHrMessages(assessments: HrAssessment[], benchmarkCents: number): ChatMessage[] {
  const rows = assessments
    .map((a) => `- id=${a.traderId} verdict=${a.verdict} excessCents=${a.excessCents} reason="${a.reason}"`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "You are the HR director of a paper-trading firm. You see the exact same evidence a rule-based " +
        "system already computed (net result vs a random-decider benchmark on the same window). Decide " +
        "promote/retire/hold for each trader id. NEVER retire or promote insufficient_evidence traders — " +
        "hold them. Respond with ONLY a JSON object: {\"promote\": [ids], \"retire\": [ids], \"hold\": [ids]}.",
    },
    {
      role: "user",
      content: `Benchmark this window: ${benchmarkCents} cents.\n\nTraders:\n${rows || "(none live)"}`,
    },
  ];
}

export async function decideHrLlm(opts: {
  db: MotorDb; client: ChatClient; spendCap: SpendCap;
  genNumber: number; ts: number; assessments: HrAssessment[]; benchmarkCents: number;
  log?: (line: string) => void;
}): Promise<HrDecision> {
  const { assessments } = opts;
  // Safest fallback: hold everyone — never fires or promotes on an LLM
  // problem, matching the rule-based system's own "insufficient_evidence
  // is a hard hold" philosophy.
  const fallback: HrDecision = { promote: [], retire: [], hold: assessments.map((a) => a.traderId) };

  const result = await resolveJournaledDecision({
    db: opts.db, genNumber: opts.genNumber, ts: opts.ts, role: "hr",
    schema: HrLlmDecisionSchema, maxTokens: HR_MAX_OUTPUT_TOKENS,
    client: opts.client, spendCap: opts.spendCap, fallback, log: opts.log,
    buildMessages: () => buildHrMessages(assessments, opts.benchmarkCents),
  });

  // A hallucinated trader id would silently no-op downstream (applyHrDecision
  // looks up by id in the live roster) — filtered here explicitly so the
  // hr_review event's reported counts only ever reflect real traders.
  const validIds = new Set(assessments.map((a) => a.traderId));
  return {
    promote: result.promote.filter((id) => validIds.has(id)),
    retire: result.retire.filter((id) => validIds.has(id)),
    hold: result.hold.filter((id) => validIds.has(id)),
  };
}

// ---------------------------------------------------------------------------
// CFO
// ---------------------------------------------------------------------------

const CFO_MAX_OUTPUT_TOKENS = 150;

const CfoDecisionSchema = z.object({
  deployFraction: z.number().min(0).max(1),
  holdReason: z.string(),
});

export interface CfoDecision {
  deployFraction: number;
  holdReason: string;
}

function buildCfoMessages(opts: {
  reserveMc: number; liveCount: number; rosterSize: number; trailingEquityTrendMc: number[];
}): ChatMessage[] {
  const trend = opts.trailingEquityTrendMc.map((mc) => (mc / 100_000).toFixed(2)).join(", ");
  return [
    {
      role: "system",
      content:
        "You are the CFO of a paper-trading firm. You decide what fraction (0.0-1.0) of the available " +
        "cash reserve to deploy on new hires this review, versus holding it back. 1.0 reproduces the " +
        "default always-deploy behavior. Respond with ONLY a JSON object: " +
        '{"deployFraction": number, "holdReason": string}.',
    },
    {
      role: "user",
      content:
        `Reserve: $${(opts.reserveMc / 100_000).toFixed(2)}. Live roster: ${opts.liveCount}/${opts.rosterSize}.\n` +
        `Trailing firm equity ($, oldest to newest): ${trend || "(no history yet)"}`,
    },
  ];
}

export async function decideCfoDeployment(opts: {
  db: MotorDb; client: ChatClient; spendCap: SpendCap;
  genNumber: number; ts: number;
  reserveMc: number; liveCount: number; rosterSize: number; trailingEquityTrendMc: number[];
  log?: (line: string) => void;
}): Promise<CfoDecision> {
  const fallback: CfoDecision = { deployFraction: 1, holdReason: "fallback: deploy fully (LLM unavailable or capped)" };

  return resolveJournaledDecision({
    db: opts.db, genNumber: opts.genNumber, ts: opts.ts, role: "cfo",
    schema: CfoDecisionSchema, maxTokens: CFO_MAX_OUTPUT_TOKENS,
    client: opts.client, spendCap: opts.spendCap, fallback, log: opts.log,
    buildMessages: () => buildCfoMessages(opts),
  });
}

// ---------------------------------------------------------------------------
// CEO
// ---------------------------------------------------------------------------

const CEO_MAX_OUTPUT_TOKENS = 250;

const CeoGuidanceSchema = z.object({
  preferredFamilies: z.array(z.enum(SIGNAL_FAMILIES)),
  leverageBias: z.enum(["increase", "decrease", "neutral"]),
  notes: z.string(),
});

export interface CeoGuidance {
  preferredFamilies: SignalGeneFamily[];
  leverageBias: "increase" | "decrease" | "neutral";
  notes: string;
}

export interface EndedGenerationSummary {
  genNumber: number;
  peakEquityMc: number;
  finalEquityMc: number;
  topGenomeFamilies: SignalGeneFamily[][]; // one array of families per top genome
}

function buildCeoMessages(history: EndedGenerationSummary[]): ChatMessage[] {
  const rows = history
    .map((g) => `- gen ${g.genNumber}: peak $${(g.peakEquityMc / 100_000).toFixed(2)}, ` +
      `final $${(g.finalEquityMc / 100_000).toFixed(2)}, top genomes' families: ` +
      `${g.topGenomeFamilies.map((f) => `[${f.join(",")}]`).join(" ")}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        "You are the Head of Quantitative Strategy of a paper-trading firm. Genes come from three " +
        "families: momentum, meanReversion, breakout. Based on past generations, state which families " +
        "you want the next generation's mutations biased toward (can be empty), and whether leverage " +
        "should trend up, down, or stay neutral. This is a soft bias, not a hard override. Respond with " +
        'ONLY a JSON object: {"preferredFamilies": [...], "leverageBias": "increase"|"decrease"|"neutral", "notes": string}.',
    },
    {
      role: "user",
      content: `Recent ended generations:\n${rows || "(none ended yet)"}`,
    },
  ];
}

export async function decideCeoGuidance(opts: {
  db: MotorDb; client: ChatClient; spendCap: SpendCap;
  genNumber: number; ts: number; history: EndedGenerationSummary[];
  log?: (line: string) => void;
}): Promise<CeoGuidance> {
  const fallback: CeoGuidance = { preferredFamilies: [], leverageBias: "neutral", notes: "fallback: no bias (LLM unavailable or capped)" };

  return resolveJournaledDecision({
    db: opts.db, genNumber: opts.genNumber, ts: opts.ts, role: "ceo",
    schema: CeoGuidanceSchema, maxTokens: CEO_MAX_OUTPUT_TOKENS,
    client: opts.client, spendCap: opts.spendCap, fallback, log: opts.log,
    buildMessages: () => buildCeoMessages(opts.history),
  });
}

const GUIDED_MUTATION_SALT = 424_242;
const GUIDED_LEVERAGE_SALT = 424_243;

/**
 * A thin wrapper around `mutateGenome` (which is unchanged and does all its
 * usual rolls) that then, with a seeded 70% chance when the CEO named at
 * least one preferred family, swaps ONE gene for a fresh gene from that
 * family — and, with a seeded 50% chance, nudges leverage one step in the
 * CEO's stated direction. Both are soft, probabilistic nudges, never a hard
 * override — deterministic in (genome, seed, guidance), same invariant the
 * rest of this codebase's genome mutation already guarantees.
 */
export function mutateGenomeGuided(genome: Genome, seed: number, guidance: CeoGuidance): Genome {
  const base = mutateGenome(genome, seed);
  const withLeverageBias = applyLeverageBias(base, guidance.leverageBias, seed);
  if (guidance.preferredFamilies.length === 0) return withLeverageBias;

  const rng = mulberry32(hashSeed(seed, GUIDED_MUTATION_SALT));
  if (rng() >= 0.7) return withLeverageBias;

  const family = guidance.preferredFamilies[Math.floor(rng() * guidance.preferredFamilies.length)];
  const newGene = makeGene(rng, family);
  const idx = Math.floor(rng() * withLeverageBias.genes.length);
  return { ...withLeverageBias, genes: withLeverageBias.genes.map((g, i) => (i === idx ? newGene : g)) };
}

function applyLeverageBias(genome: Genome, bias: CeoGuidance["leverageBias"], seed: number): Genome {
  if (bias === "neutral") return genome;
  const rng = mulberry32(hashSeed(seed, GUIDED_LEVERAGE_SALT));
  if (rng() >= 0.5) return genome;
  const delta = bias === "increase" ? 1 : -1;
  const leverage = Math.min(3, Math.max(1, genome.leverage + delta));
  return { ...genome, leverage };
}
