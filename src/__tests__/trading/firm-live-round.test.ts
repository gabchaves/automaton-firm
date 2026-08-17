/**
 * One LIVE firm round (gated by RUN_FIRM_LIVE=1). Runs a real Gemini-3-Flash
 * (via fal) trader tick for every live senior against a persistent DB
 * (~/.automaton/firm-live.db) using real Binance prices. Intended to be called
 * repeatedly (spaced out) so the market can move. Not a CI test.
 *
 *   RUN_FIRM_LIVE=1 FAL_API_KEY=... vitest run firm-live-round
 */
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, getTrader, listTraders } from "../../trading/repo.js";
import { runTraderTick } from "../../trading/tick-runner.js";
import { createBinanceFeed } from "../../trading/feed.js";
import { ProviderRegistry } from "../../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../../inference/inference-client.js";
import { createWorkerInferenceBridge } from "../../agent/worker-inference-bridge.js";
import { createLocalClient } from "../../conway/local-client.js";
import { createTestConfig, createTestIdentity } from "../mocks.js";

const RUN = process.env.RUN_FIRM_LIVE === "1";

describe.skipIf(!RUN)("firm live round (Gemini 3 Flash via fal)", () => {
  it("runs one real trader tick per live senior", async () => {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const appDb = createDatabase(path.join(home, ".automaton", "firm-live.db"));

    for (const id of ["alpha", "bravo", "charlie"]) {
      if (!getTrader(appDb.raw, id)) {
        insertTrader(appDb.raw, {
          id, name: id, role: "senior", parentId: null, bookBalanceCents: 10_000,
          status: "live", generation: 0, strategySkill: "strategy-base",
          bornAt: new Date().toISOString(), diedAt: null, realizedPnlCents: 0,
        });
      }
    }

    const providersPath = path.join(home, ".automaton", "inference-providers.json");
    const inference = createWorkerInferenceBridge(new UnifiedInferenceClient(ProviderRegistry.fromConfig(providersPath)));
    const conway = createLocalClient({ startingCents: 100_000, getSpentCents: () => 0, homeDir: home });

    const results = await runTraderTick({
      db: appDb, conway, config: createTestConfig(), identity: createTestIdentity(),
      inference, feed: createBinanceFeed(), workspaceRoot: path.join(home, ".automaton", "workspace"),
    });

    for (const t of listTraders(appDb.raw, "live")) {
      // eslint-disable-next-line no-console
      console.log(`FIRM-LIVE trader=${t.id} book=${t.bookBalanceCents}c realizedPnl=${t.realizedPnlCents}c`);
    }
    // eslint-disable-next-line no-console
    console.log("FIRM-LIVE results:", JSON.stringify(results));
    expect(results.length).toBeGreaterThan(0);
    appDb.close();
  }, 180_000);
});
