/**
 * Live CEO-driven funding-carry evolution (gated by RUN_CARRY_EVOLUTION=1).
 * Evolves carry params over disjoint train/eval funding windows using real
 * inference (fal/Gemini). Appends each generation to ~/.automaton/carry-lineage.jsonl
 * so the realtime server (scripts/lineage-server.mjs) shows it live.
 *
 *   RUN_CARRY_EVOLUTION=1 vitest run carry-evolution
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import { fetchCarrySeries } from "../../trading/funding-feed.js";
import { evolveCarryGenerations } from "../../trading/evolve-carry.js";
import { ProviderRegistry } from "../../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../../inference/inference-client.js";
import { createWorkerInferenceBridge } from "../../agent/worker-inference-bridge.js";

const run = process.env.RUN_CARRY_EVOLUTION === "1";
const GENERATIONS = Number(process.env.CARRY_GENERATIONS || 10);

describe.skipIf(!run)("Live CEO funding-carry evolution (gated)", () => {
  it(
    "evolves carry params over disjoint train/eval funding windows",
    async () => {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
      const lineagePath = path.join(home, ".automaton", "carry-lineage.jsonl");
      fs.mkdirSync(path.dirname(lineagePath), { recursive: true });
      fs.writeFileSync(lineagePath, ""); // truncate previous run

      const all = await fetchCarrySeries("BTCUSDT", 1000);
      expect(all.length).toBeGreaterThan(100);
      const mid = Math.floor(all.length / 2);
      const trainBars = all.slice(0, mid);
      const evalBars = all.slice(mid); // newer half => genuine forward out-of-sample
      console.log(`Disjoint funding windows: Train=${trainBars.length}, Eval=${evalBars.length}, Generations=${GENERATIONS}`);

      const providersPath = path.join(home, ".automaton", "inference-providers.json");
      const inference = createWorkerInferenceBridge(
        new UnifiedInferenceClient(ProviderRegistry.fromConfig(providersPath)),
      );

      const records = await evolveCarryGenerations({
        inference,
        trainBars,
        evalBars,
        generations: GENERATIONS,
        startCents: 1_000_000,
        homeDir: home,
        onGeneration: (r) => {
          fs.appendFileSync(lineagePath, JSON.stringify(r) + "\n");
          console.log(
            `[carry gen ${r.generation}] net $${(r.evalResult.realizedPnlCents / 100).toFixed(2)}, ` +
              `funding $${(r.evalResult.fundingCollectedCents / 100).toFixed(2)}, ` +
              `fees $${(r.evalResult.feesPaidCents / 100).toFixed(2)}, ` +
              `cycles ${r.evalResult.closedTrades}, kept=${r.keptAsIncumbent}`,
          );
        },
      });

      expect(records.length).toBe(GENERATIONS);
    },
    3_600_000, // 60 min ceiling
  );
});
