# Motor executive agents (CEO / HR / CFO) — design

2026-08-20. Extends `docs/superpowers/specs/2026-08-17-motor-live-firm-design.md`
and the short-selling entry alongside it. Complements — does not replace —
the CEO-driven strategist system in `src/trading/strategist.ts`/`evolve.ts`
(Experiment 1, `docs/TRADING-RESEARCH.md`), which already tested "does an
LLM writing strategy beat a baseline" on a different, older system and found
no edge. This spec asks a different, narrower question on the current
`motor` system: does LLM-governed **generation-level policy** (who gets
hired/fired, how mutation explores, how cash gets deployed) beat mechanical
rule-based policy — not "does an LLM predict price better."

## Motivation

The `motor` system has two cohorts today: `evolved` (genome + deterministic
rule-based HR) and `random` (control). Both are validated, both are trusted
— `docs/TRADING-RESEARCH.md`'s sweep entries depend on them staying exactly
as they are. This adds a **third** cohort, `llm-governed`, so an LLM
executive layer is judged against both existing cohorts using the same
6-window backtest sweep, rather than replacing anything already trusted.

## Scope

In scope: a new `llm-governed` cohort parallel to `evolved`/`random`; three
LLM decision points (CEO, HR, CFO) at generation-level cadence; a journal
table for deterministic replay; `scripts/backtest-sweep.mjs` extended to
report all three cohorts.

Out of scope (this pass):
- **Not live on Palco yet.** `tick()`'s live cohort list only seeds
  `llm-governed` when an inference provider is actually configured
  (`ProviderRegistry.fromConfig` succeeds against
  `~/.automaton/inference-providers.json`) — this is a capability check, the
  same pattern already used elsewhere in this codebase for graceful
  degradation (e.g. `topup.ts` skipping when balance is too low), not a
  feature flag. `scripts/backtest-sweep.mjs` requires the provider and
  throws clearly if missing, since validation is the point. Whether to
  promote this to the live deployment is a separate decision after the
  sweep results are in — real (if cheap) ongoing API cost and an external
  dependency the live process may or may not have configured.
- Per-bar trading decisions: `llm-governed` traders still use
  `genomeDirection` exactly like `evolved` — no LLM in the hot path.
- Palco frontend UI for the new cohort (data layer only, per the pattern in
  the short-selling entry).
- The older `strategist.ts`/`evolve.ts` system — untouched.

## Design

### 1. Journal table (`src/motor/db.ts`)

```sql
CREATE TABLE IF NOT EXISTS llm_decisions (
  gen_number INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ceo','hr','cfo')),
  decision_json TEXT NOT NULL,
  raw_response TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  cost_credits REAL NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (gen_number, ts, role)
);
```

Keyed by `(genNumber, ts, role)` — not `generationId` — because `genNumber`
and `ts` are the two things guaranteed identical across replays of the same
historical window (bar timestamps are real epoch ms; `genNumber` always
starts at 1 for a fresh cohort), while `generationId` is a derived ULID that
would need recomputing to use as a lookup key. Only the `llm-governed`
cohort ever writes to this table.

Lookup-or-call is the same shape for all three roles: check for an existing
row at `(genNumber, ts, role)`; if present, parse `decision_json` and skip
inference entirely; if absent, call the LLM, validate the response against
the role's Zod schema, insert the row, then use it. Replaying an
already-processed window costs zero new API calls; a new window calls the
LLM once per decision point and journals it permanently.

### 2. Inference wiring (`src/motor/llm-agents.ts`, new)

Reuses existing infrastructure — no new provider/HTTP code:

```ts
const registry = ProviderRegistry.fromConfig(inferenceProvidersPath);
const inference = createWorkerInferenceBridge(new UnifiedInferenceClient(registry));
```

`inference.chat({ tier, messages, responseFormat: { type: "json_object" } })`
per decision, `tier: "reasoning"` (same tier `strategist.ts` uses). Each
role's prompt-builder + Zod response schema + journal read/write lives in
this one file, since all three share the same call/journal shape and differ
only in prompt content and output schema.

### 3. Role interfaces

**CEO** — runs once per generation-end (same moment `handleGenerationEnd`
already computes `topGenomes`), reads the last few ended generations' peak
equity, final equity, and the composition of the top-performing genomes.
Returns:

```ts
{ preferredFamilies: GeneFamily[]; leverageBias: "increase" | "decrease" | "neutral"; notes: string }
```

Consumed by a new `mutateGenomeGuided(genome, seed, bias)` — a thin wrapper
around the existing `mutateGenome` that, when the mutation roll would add or
swap a gene, weights family selection toward `preferredFamilies` (70% if
non-empty, else identical to today's uniform pick) and nudges the leverage
mutation's direction to match `leverageBias`. `notes` is journaled for human
reading only; it holds no decision authority — keeps this from becoming a
free-text-parsed control surface.

**HR** — runs daily, same `ts % HR_DAY_MS === 0` cadence as today. Reads the
exact same `TraderEvidence[]` the current `assessTrader`/`decideHrActions`
already compute (net vs benchmark, trade count) — the LLM sees the same
inputs the rule-based system does, no extra narrative context in v1, so any
difference in outcome is attributable to the decision policy, not to
information the rule-based HR didn't have. Returns:

```ts
{ promote: string[]; retire: string[]; hold: string[] }
```

Same shape as `HrDecision` — a direct drop-in alternative to
`decideHrActions`, so `runHrReview` takes the decision function as a
parameter instead of calling `decideHrActions` directly, and the
`llm-governed` cohort's HR review passes the LLM-backed one.

**CFO** — runs alongside HR (same daily cadence, after fire/promote, before
the hire loop). Reads `reserveMc`, live roster count, and the trailing
7-day equity trend. Returns:

```ts
{ deployFraction: number; holdReason: string }
```

`deployFraction` (clamped 0–1) multiplies the stake each hire would
otherwise receive (`min(reserve, TRADER_START_MC) * deployFraction`) —
`1.0` reproduces today's always-deploy behavior exactly; lower values hold
cash back. `holdReason` is journaled, not authoritative.

### 4. Cohort plumbing

`"evolved" | "random"` widens to `"evolved" | "random" | "llm-governed"`
everywhere it's a literal union (`db.ts`, `cohort.ts`, `events.ts`,
`tick.ts`, `palco-data.ts`, `motor/index.ts` — mechanical, ~23 call sites).
`llm-governed` seeds and steps identically to `evolved` (same
`seedEvolvedGenomes`-style logic, same `genomeDirection` trading) — the only
divergence is which mutation function and which HR decision function get
called for it, per §3.

### 5. Testing plan

- Unit tests for `llm-agents.ts` use a scripted mock `WorkerInferenceClient`
  (same pattern as the existing `firm-dry-run.integration.test.ts`) — no
  real API calls in the default suite.
- Journal replay test: same `(genNumber, ts, role)` key called twice returns
  the journaled decision the second time without invoking the mock's chat
  function again (assert call count).
- `mutateGenomeGuided` test: with a `preferredFamilies` bias, family
  selection favors it over many trials (statistical, like the existing
  `randomGenome`/`mutateGenome` distribution tests) without becoming
  deterministic (still bounded randomness, never 100%).
- HR/CFO decision-function swap tests mirror the existing `hr.test.ts`
  structure, injecting the LLM-backed function instead of `decideHrActions`.
- A new gated test (`RUN_LLM_FIRM=1`, matching `RUN_SWEEP`/`RUN_CARRY_FIRM`
  etc.'s existing convention) exercises one real inference call per role
  against the configured provider.

### 6. Validation plan

`scripts/backtest-sweep.mjs` reports peak-edge and final-edge for
`llm-governed` vs `random` **and** `llm-governed` vs `evolved`, same 6
disjoint 90-day windows already used. First run per window costs real
(cheap — tier `reasoning`, ~$0.00002/call per the existing fal/Gemini 3
Flash setup, bounded to ~3 calls/day × 90 days × 6 windows ≈ 1,620 calls
total ≈ cents) inference; re-runs are free via the journal. Reported
honestly regardless of outcome — per the whole session's pattern, the
expected result given `docs/TRADING-RESEARCH.md`'s standing conclusion
("more generations, more symbols, more compute, or a better LLM" already
ruled out as the answer) is another null result, and that is a valid,
reportable finding, not a failure to fix.
