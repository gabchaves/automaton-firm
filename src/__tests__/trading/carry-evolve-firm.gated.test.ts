/**
 * Live self-evolving firm runner (gated by RUN_EVOLVE_FIRM=1).
 * Evolves strategies with CEO LLM over train/eval windows, picks the top evolved archetypes,
 * and runs the firm with them.
 *
 *   RUN_EVOLVE_FIRM=1 vitest run carry-evolve-firm.gated
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import { fetchCarrySeriesRange } from "../../trading/funding-feed.js";
import { evolveCarryGenerations } from "../../trading/evolve-carry.js";
import { archetypesFromLineage } from "../../trading/lineage-to-archetypes.js";
import { runCarryFirm } from "../../trading/carry-firm.js";
import { createDatabase } from "../../state/database.js";
import { ProviderRegistry } from "../../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../../inference/inference-client.js";
import { createWorkerInferenceBridge } from "../../agent/worker-inference-bridge.js";

const run = process.env.RUN_EVOLVE_FIRM === "1";
const GENERATIONS = Number(process.env.CARRY_GENERATIONS || 5);

describe.skipIf(!run)("Self-Evolving Carry Firm (gated)", () => {
  it(
    "evolves carry strategies and feeds top archetypes to the firm",
    async () => {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
      const start = Date.parse("2021-01-01T00:00:00Z");
      const end = Date.parse("2021-05-01T00:00:00Z");
      const allBars = await fetchCarrySeriesRange("BTCUSDT", start, end);
      expect(allBars.length).toBeGreaterThan(100);

      const mid = Math.floor(allBars.length / 2);
      const trainBars = allBars.slice(0, mid);
      const evalBars = allBars.slice(mid);

      const providersPath = path.join(home, ".automaton", "inference-providers.json");
      const inference = createWorkerInferenceBridge(
        new UnifiedInferenceClient(ProviderRegistry.fromConfig(providersPath)),
      );

      console.log(`Evolving ${GENERATIONS} generations over 2021 bull funding...`);
      const records = await evolveCarryGenerations({
        inference,
        trainBars,
        evalBars,
        generations: GENERATIONS,
        startCents: 1_000_000,
        homeDir: home,
        onGeneration: (r) => {
          console.log(`[Evo Gen ${r.generation}] ${r.strategySkill} net $${(r.evalResult.realizedPnlCents / 100).toFixed(2)} (kept: ${r.keptAsIncumbent})`);
        },
      });

      const archetypes = archetypesFromLineage(records, 3);
      console.log("Top archetypes for firm:", archetypes.map((a) => a.name));

      const dbPath = path.join(home, ".automaton", "carry-firm.db");
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.rmSync(dbPath, { force: true });
      const db = createDatabase(dbPath);

      const res = runCarryFirm({
        db,
        bars: allBars,
        seniorStartCents: 100_000,
        archetypes,
        homeDir: home,
      });
      db.close();

      console.log(`Firm executed with evolved archetypes: ${res.traders.length} traders total.`);
      expect(res.traders.length).toBeGreaterThanOrEqual(3);
    },
    600_000,
  );
});
