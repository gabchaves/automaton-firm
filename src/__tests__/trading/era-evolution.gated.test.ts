/**
 * Live era-evolution runner (gated by RUN_ERA=1): fetches real SOLUSDT price
 * history 2021-2026, splits it into calendar-year eras by each bar's real
 * timestamp, and runs the chained walk-forward selection experiment across
 * them, writing ~/.automaton/era-evolution.json for the dashboard.
 *
 *   RUN_ERA=1 vitest run era-evolution.gated
 *
 * This test asserts structure only. It must NEVER assert that survivors
 * beat the fresh control population -- that would defeat the purpose of
 * the experiment (the honest comparison decides that, not us).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import { fetchCarrySeriesRange } from "../../trading/funding-feed.js";
import { runEraChain } from "../../trading/era-evolution.js";
import type { Era } from "../../trading/era-evolution.js";

const run = process.env.RUN_ERA === "1";

const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];

describe.skipIf(!run)("Era Evolution — Chained Selection Across Time (gated)", () => {
  it(
    "runs the era chain on real SOLUSDT history split by calendar year and records era-evolution.json",
    async () => {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();

      const start = Date.parse("2021-01-01T00:00:00Z");
      const end = Date.parse("2026-08-01T00:00:00Z");
      const bars = await fetchCarrySeriesRange("SOLUSDT", start, end);

      // Split by each bar's real timestamp (calendar year), not by index, so
      // the eras reflect actual regimes rather than arbitrary chunk boundaries.
      // Every nominal year 2021-2026 is represented (even if empty) so a year
      // with no data is recorded by the chain as an explicitly skipped era,
      // never silently dropped from the list.
      const eras: Era[] = YEARS.map((year) => ({
        label: String(year),
        prices: bars.filter((b) => new Date(b.time).getUTCFullYear() === year).map((b) => b.spotCents),
      }));

      const chain = runEraChain({
        eras,
        populationSize: 60,
        startCents: 300,
        seed: 20260817,
      });

      for (const e of chain.eras) {
        if (e.skipped) {
          console.log(`[${e.era}] SKIPPED: ${e.skipped} (population ${e.populationBefore} carried forward)`);
        } else {
          console.log(
            `[${e.era}] population ${e.populationBefore} -> ${e.survivors} survivors (eliminated ${e.eliminated}, died ${e.died}), benchmark ${e.benchmarkCents}c, median net ${e.medianNetCents}c`,
          );
        }
      }
      if (chain.finalComparison) {
        console.log(
          `Final comparison: survivors(${chain.finalComparison.survivorCount}) median ${chain.finalComparison.survivorMedianNetCents}c vs fresh(${chain.finalComparison.freshCount}) median ${chain.finalComparison.freshMedianNetCents}c — survivorsBeatFresh=${chain.finalComparison.survivorsBeatFresh}`,
        );
      }
      console.log(`Verdict: ${chain.verdict}`);

      const generatedAt = new Date().toISOString();
      const outJson = path.join(home, ".automaton", "era-evolution.json");
      fs.mkdirSync(path.dirname(outJson), { recursive: true });
      fs.writeFileSync(outJson, JSON.stringify({ generatedAt, chain }, null, 2), "utf-8");
      console.log(`Era evolution summary written to ${outJson}`);

      // Structure only -- never assert that survivors beat fresh.
      expect(eras.length).toBe(YEARS.length);
      expect(chain.eras.length).toBe(eras.length - 1);
      expect(chain.finalComparison).not.toBeNull();
      expect(chain.finalPopulation.length).toBeGreaterThan(0);
      expect(chain.finalComparison!.freshCount).toBe(60);
    },
    900_000,
  );
});
