/**
 * Live resilience lab runner (gated by RUN_RESILIENCE=1): fetches a volatile
 * alt's real price history and runs the Monte Carlo skill-vs-luck experiment
 * on it, writing ~/.automaton/resilience.json for the dashboard.
 *
 *   RUN_RESILIENCE=1 vitest run resilience.gated
 *
 * This test asserts structure only (trial count, both cohorts present). It
 * must NEVER assert that the smart cohort wins -- that would defeat the
 * purpose of the experiment (the pre-registered rule decides that, not us).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import { fetchCarrySeriesRange } from "../../trading/funding-feed.js";
import { runResilienceLab } from "../../trading/resilience-lab.js";

const run = process.env.RUN_RESILIENCE === "1";

describe.skipIf(!run)("Resilience Lab — Skill vs Luck (gated)", () => {
  it(
    "runs the Monte Carlo lab on real SOLUSDT history and records resilience.json",
    async () => {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();

      const start = Date.parse("2021-01-01T00:00:00Z");
      const end = Date.parse("2026-08-01T00:00:00Z");
      const bars = await fetchCarrySeriesRange("SOLUSDT", start, end);
      const prices = bars.map((b) => b.spotCents);

      // startCents: 300 == the user's $3-per-trader firm.
      const result = runResilienceLab({
        prices,
        trials: 500,
        windowBars: 90,
        tradersPerCohort: 3,
        startCents: 300,
        seed: 20260817,
      });

      const outJson = path.join(home, ".automaton", "resilience.json");
      fs.mkdirSync(path.dirname(outJson), { recursive: true });
      fs.writeFileSync(outJson, JSON.stringify({ ...result, generatedAt: new Date().toISOString() }, null, 2), "utf-8");
      console.log(`Resilience lab summary written to ${outJson}`);
      console.log(`Verdict: ${result.verdict}`);
      console.log(
        `Smart:  traders=${result.smart.traders} ruin=${result.smart.ruinRatePct.toFixed(1)}% win=${result.smart.winRatePct.toFixed(1)}% medianFinal=${result.smart.medianFinalEquityCents}c`,
      );
      console.log(
        `Random: traders=${result.random.traders} ruin=${result.random.ruinRatePct.toFixed(1)}% win=${result.random.winRatePct.toFixed(1)}% medianFinal=${result.random.medianFinalEquityCents}c`,
      );
      console.log(`Paired win %: ${result.pairedWinPct.toFixed(1)}%`);

      // Structure only -- never assert that the smart cohort wins.
      expect(result.trials).toBe(500);
      expect(result.smart).toBeDefined();
      expect(result.random).toBeDefined();
      expect(result.smart.traders).toBe(500 * 3);
      expect(result.random.traders).toBe(500 * 3);
    },
    600_000,
  );
});
