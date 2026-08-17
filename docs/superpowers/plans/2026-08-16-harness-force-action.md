# Harness Force-Action — Short Plan (make traders act, not narrate)

**Goal:** Stop the trader from "narrating and quitting." Today, when the model returns a text-only response (no tool call), `BaseHarness.execute()` ends the tick as success — so a trader that writes analysis prose but never calls `place_order`/`close_position`/`task_done` finishes having done nothing. Make the trading harness nudge the model to actually act, without changing behavior for any other harness.

**Why this, not a bigger model:** The machine's GPU (RX 7600, 8GB) fits qwen2.5:7b (runs 100% on GPU, fast) but NOT 14b (spills to CPU, ~180s/tick). So a bigger local model is not an option — the fast, fitting 7b must be made reliable instead. The failure is behavioral (narrate-and-quit), which this fixes.

## Context (read before starting)

- `src/agent/harnesses/base-harness.ts` `execute()` runs the ReAct loop. Near the end, a response with **no tool calls** does: `finalOutput = response.content; finalSuccess = true; break;` — i.e., text-only = done+success. That is the narrate-and-quit path.
- `src/agent/harnesses/trading-harness.ts` (`TradingHarness`, id `"trader"`) is the only harness that must never accept a no-action tick.
- Verified live: with 7b, the trader does `get_book → get_candles → get_price` then emits a text-only "Let's analyze..." and the loop ends. Book unchanged.

## Hard rules

- **`BaseHarness` is shared** by GeneralHarness, OrchestratorHarness, and TradingHarness. The change here MUST be behavior-preserving for all of them by default. This file is core — the maintainer reviews the diff before merge.
- **Node 22** (`fnm use 22`; better-sqlite3 prebuild is for Node 22 — if it breaks with "Could not locate the bindings file", run `pnpm rebuild better-sqlite3` under Node 22). Do NOT run installs under Node 25.
- Run tests via vitest as elsewhere; 19 pre-existing repo failures are not yours.
- ESM `.js` import specifiers. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Behavior-preserving text-only hook in BaseHarness

**Files:**
- Modify: `src/agent/harnesses/base-harness.ts`
- Test: `src/__tests__/agent/base-harness-textonly.test.ts`

**Interfaces:**
- Produces: `protected onTextOnlyResponse(content: string): { continue: boolean; nudge?: string }` on `BaseHarness`. Default returns `{ continue: false }` (current behavior: text-only ends the task). Subclasses may override to keep the loop going with a nudge.

- [ ] **Step 1: Write the regression + behavior test**

```ts
// src/__tests__/agent/base-harness-textonly.test.ts
import { describe, it, expect } from "vitest";
import { BaseHarness } from "../../agent/harnesses/base-harness.js";
import type { HarnessTool, HarnessContext } from "../../agent/harness-types.js";
import type { TaskNode } from "../../orchestration/task-graph.js";

// Minimal concrete harness using the DEFAULT hook.
class PlainHarness extends BaseHarness {
  readonly id = "plain";
  readonly description = "plain";
  buildSystemPrompt() { return "sys"; }
  getToolDefs(): HarnessTool[] { return []; }
}

function ctx(inference: any): HarnessContext {
  return {
    workspaceRoot: ".", allowedEditRoot: ".", workspace: {} as any,
    identity: {} as any, config: {} as any, db: {} as any, conway: {} as any,
    inference,
    budget: { maxTurns: 5, maxCostCents: 50, timeoutMs: 5000, turnsUsed: 0, costUsedCents: 0, startedAt: 0 },
    wisdom: { conventions: [], successes: [], failures: [], gotchas: [] },
    abortSignal: new AbortController().signal, goalId: "g",
    toolCatalog: [], toolContext: undefined,
  };
}

const task: TaskNode = {
  id: "t", parentId: null, goalId: "g", title: "t", description: "", status: "assigned",
  assignedTo: "w", agentRole: "x", priority: 50, dependencies: [], result: null,
  metadata: { estimatedCostCents: 5, actualCostCents: 0, maxRetries: 0, retryCount: 0, timeoutMs: 5000, createdAt: "t", startedAt: null, completedAt: null },
};

describe("BaseHarness text-only handling (default unchanged)", () => {
  it("ends the task on a text-only response by default", async () => {
    let calls = 0;
    const inference = { chat: async () => { calls++; return { content: "final answer, no tools" }; } };
    const h = new PlainHarness();
    await h.initialize(task, ctx(inference));
    const result = await h.execute();
    expect(result.success).toBe(true);
    expect(result.output).toContain("final answer");
    expect(calls).toBe(1); // did NOT loop — default behavior preserved
  });
});
```

- [ ] **Step 2: Run → FAIL** (compile error: `onTextOnlyResponse` not yet a member, or the test just passes if behavior already matches — either way, establish the baseline). Run: `pnpm test -- base-harness-textonly`.

- [ ] **Step 3: Add the hook and route text-only through it**

In `base-harness.ts`, add the protected method:

```ts
/**
 * Called when the model returns a response with no tool calls. Default:
 * the task is done. Subclasses may override to keep looping (with a nudge)
 * when a text-only response is not an acceptable way to finish.
 */
protected onTextOnlyResponse(_content: string): { continue: boolean; nudge?: string } {
  return { continue: false };
}
```

Then in `execute()`, replace the text-only terminal block:

```ts
      // (was)
      // finalOutput = response.content || "Task completed.";
      // finalSuccess = true;
      // break;

      const textOnly = this.onTextOnlyResponse(response.content || "");
      if (textOnly.continue) {
        this.messages.push({ role: "assistant", content: response.content || "" });
        this.messages.push({ role: "system", content: textOnly.nudge ?? "Continue by calling a tool." });
        continue;
      }
      finalOutput = response.content || "Task completed.";
      finalSuccess = true;
      logger.info(`[${this.id}] Text-only response on turn ${this.context.budget.turnsUsed}: ${finalOutput.slice(0, 200)}`);
      break;
```

(The `checkBudget()`/`maxTurns` cap already bounds the loop, so a subclass that always continues can never spin forever.)

- [ ] **Step 4: Run → PASS.** The default path still ends in one call. `pnpm run typecheck`.

- [ ] **Step 5: Regression — existing harness tests unaffected**

Run: `pnpm test -- general-harness orchestrator-harness trading-harness loop`
Expected: all still pass (behavior preserved for non-overriding harnesses). If any regress, the hook default is wrong — fix the default, not the tests.

- [ ] **Step 6: Commit**

```bash
git add src/agent/harnesses/base-harness.ts src/__tests__/agent/base-harness-textonly.test.ts
git commit -m "refactor(harness): add onTextOnlyResponse hook (default behavior unchanged)"
```

---

## Task 2: TradingHarness nudges to act (bounded)

**Files:**
- Modify: `src/agent/harnesses/trading-harness.ts`
- Test: `src/__tests__/trading/trader-forces-action.test.ts`

**Interfaces:**
- `TradingHarness` overrides `onTextOnlyResponse` to nudge the model to call a tool, at most twice, then gives up (returns `{ continue: false }` so the tick still terminates).

- [ ] **Step 1: Write the failing test (narrate-once, then act)**

```ts
// src/__tests__/trading/trader-forces-action.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, getTrader } from "../../trading/repo.js";
import { PaperSimulator } from "../../trading/simulator.js";
import { createTradingTools } from "../../trading/tools.js";
import type { PriceFeed } from "../../trading/feed.js";
import { TradingHarness } from "../../agent/harnesses/trading-harness.js";
import { PolicyEngine } from "../../agent/policy-engine.js";
import { SpendTracker } from "../../agent/spend-tracker.js";
import { createDefaultRules } from "../../agent/policy-rules/index.js";
import { AgentWorkspace } from "../../orchestration/workspace.js";
import type { HarnessContext } from "../../agent/harness-types.js";
import { createTestConfig, createTestIdentity, MockConwayClient } from "../mocks.js";

const feed: PriceFeed = { async getCandles() { return []; }, async getPrice() { return 5_000_000; } };

// Turn 1: text-only (narrate). After the nudge, Turn 2: place_order. Turn 3: task_done.
class NarrateThenAct {
  private i = 0;
  async chat() {
    this.i++;
    if (this.i === 1) return { content: "Let me analyze... I see a setup." }; // text-only narrate
    if (this.i === 2) return { content: "acting", toolCalls: [{ id: "b", function: { name: "place_order", arguments: JSON.stringify({ traderId: "t1", symbol: "BTCUSDT", side: "buy", qty: 0.001 }) } }] };
    return { content: "done", toolCalls: [{ id: "c", function: { name: "task_done", arguments: JSON.stringify({ summary: "opened long" }) } }] };
  }
}

describe("TradingHarness forces action on narrate-and-quit", () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = undefined; } });

  it("nudges a text-only turn and the trader then places the order", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "force-action-"));
    const appDb = createDatabase(path.join(dir, "state.db"));
    insertTrader(appDb.raw, { id: "t1", name: "a", role: "senior", parentId: null, bookBalanceCents: 10_000, status: "live", generation: 0, strategySkill: null, bornAt: "t", diedAt: null, realizedPnlCents: 0 });
    const sim = new PaperSimulator(appDb.raw, feed);
    const tools = createTradingTools(sim, feed);
    const context: HarnessContext = {
      workspaceRoot: path.join(dir, "ws"), allowedEditRoot: dir, workspace: new AgentWorkspace("firm", path.join(dir, "ws")),
      identity: createTestIdentity(), config: createTestConfig(), db: appDb.raw, conway: new MockConwayClient() as any,
      inference: new NarrateThenAct() as any,
      budget: { maxTurns: 10, maxCostCents: 100, timeoutMs: 10_000, turnsUsed: 0, costUsedCents: 0, startedAt: 0 },
      wisdom: { conventions: [], successes: [], failures: [], gotchas: [] },
      abortSignal: new AbortController().signal, goalId: "firm",
      toolCatalog: tools,
      toolContext: { identity: createTestIdentity(), config: createTestConfig(), db: appDb, conway: new MockConwayClient() as any, inference: { chat: async () => { throw new Error("unused"); }, setLowComputeMode: () => {}, getDefaultModel: () => "m" } },
      policyEngine: new PolicyEngine(appDb.raw, createDefaultRules()), spendTracker: new SpendTracker(appDb.raw),
    };
    const h = new TradingHarness();
    await h.initialize({ id: "tick", parentId: null, goalId: "firm", title: "tick", description: "", status: "assigned", assignedTo: "t1", agentRole: "trader", priority: 50, dependencies: [], result: null, metadata: { estimatedCostCents: 5, actualCostCents: 0, maxRetries: 0, retryCount: 0, timeoutMs: 10_000, createdAt: "t", startedAt: null, completedAt: null } }, context);
    await h.execute();
    // Without the nudge the tick would have ended on turn 1 with no order.
    expect(getTrader(appDb.raw, "t1")!.bookBalanceCents).toBe(5_000);
    appDb.close();
  });
});
```

- [ ] **Step 2: Run → FAIL** (current TradingHarness uses the default hook → ends on the turn-1 narration → book stays 10000). Run: `pnpm test -- trader-forces-action`.

- [ ] **Step 3: Override the hook in TradingHarness**

Add to `TradingHarness`:

```ts
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
```

- [ ] **Step 4: Run → PASS.** `pnpm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/agent/harnesses/trading-harness.ts src/__tests__/trading/trader-forces-action.test.ts
git commit -m "feat(trading): trader nudges itself to act instead of narrating (bounded)"
```

---

## Task 3: Live verification (gated, manual — no commit)

- [ ] Ensure Ollama is up with `qwen2.5:7b` (fits the 8GB GPU; `ollama ps` should show `100% GPU`). Config `~/.automaton/inference-providers.json` already routes the `local` provider to it.
- [ ] Run the live tick (Node 22, `HOME=$USERPROFILE`, `LIVE_OLLAMA=1`, `LOCAL_API_KEY=ollama`) on `live-ollama` with a 240s timeout.
- [ ] Expected now: harness logs show a nudge after any text-only turn, then either `place_order → Order filled ...` (book changes) or a `task_done` with an explicit HOLD. A silent narrate-and-quit should no longer happen.
- [ ] Report the observed behavior (order placed? explicit HOLD? still stuck?) in the handoff notes. This is a calibration signal, not a pass/fail gate.

---

## Notes for the reviewer (maintainer)

- The only shared-code change is the `onTextOnlyResponse` hook in `BaseHarness`; its default preserves today's behavior, and Task 1 Step 5 is the regression proof. Verify those pass.
- Optional future lever (do NOT do blindly): setting `tool_choice: "required"` for the trading harness would force a tool call every turn, but Ollama/qwen support for `required` is inconsistent and it would need its own hook + live verification. The nudge approach here is provider-agnostic and sufficient; only add `required` if the nudge proves insufficient live.
- Bound is 2 nudges; combined with the existing `maxTurns` budget and loop detector, the tick cannot spin forever.
