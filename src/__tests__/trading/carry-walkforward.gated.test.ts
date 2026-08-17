/**
 * Live carry walk-forward robustness test across 5 historical regimes (gated by RUN_WALKFORWARD=1).
 *
 *   RUN_WALKFORWARD=1 vitest run carry-walkforward.gated
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import { fetchCarrySeriesRange } from "../../trading/funding-feed.js";
import { runCarryFirm } from "../../trading/carry-firm.js";
import { createDatabase } from "../../state/database.js";
import { runCarryBacktest } from "../../trading/carry-engine.js";
import { CARRY_ARCHETYPES } from "../../trading/carry-archetypes.js";
import { summarizeWalkForward, type WindowResult } from "../../trading/walk-forward.js";

const run = process.env.RUN_WALKFORWARD === "1";

const WINDOWS = [
  { label: "2021-bull", start: Date.parse("2021-01-01T00:00:00Z"), end: Date.parse("2021-05-01T00:00:00Z") },
  { label: "2022-bear", start: Date.parse("2022-01-01T00:00:00Z"), end: Date.parse("2022-06-01T00:00:00Z") },
  { label: "2023", start: Date.parse("2023-01-01T00:00:00Z"), end: Date.parse("2023-07-01T00:00:00Z") },
  { label: "2024", start: Date.parse("2024-01-01T00:00:00Z"), end: Date.parse("2024-06-01T00:00:00Z") },
  { label: "recent-6m", start: Date.parse("2024-06-01T00:00:00Z"), end: Date.parse("2024-12-01T00:00:00Z") },
];

describe.skipIf(!run)("Carry Walk-Forward Robustness (gated)", () => {
  it(
    "runs the firm across multiple historical regimes and records walkforward.json",
    async () => {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
      const results: WindowResult[] = [];

      for (const win of WINDOWS) {
        console.log(`Fetching window ${win.label}...`);
        const bars = await fetchCarrySeriesRange("BTCUSDT", win.start, win.end);
        if (bars.length === 0) {
          console.log(`Skipping ${win.label}: no bars returned`);
          continue;
        }

        const db = createDatabase(":memory:");
        const firmRes = runCarryFirm({ db, bars, seniorStartCents: 100_000, homeDir: home });
        db.close();

        const totalPnlCents = firmRes.traders.reduce((sum, t) => sum + (t.realizedPnlCents || 0), 0);

        // Find worst drawdown across the senior archetypes on this window
        let worstDd = 0;
        for (const arch of CARRY_ARCHETYPES) {
          const bt = runCarryBacktest(bars, arch.params, 100_000);
          if (bt.maxDrawdownCents > worstDd) worstDd = bt.maxDrawdownCents;
        }

        results.push({
          label: win.label,
          totalPnlCents,
          worstDrawdownCents: worstDd,
          bars: bars.length,
          profitable: totalPnlCents > 0,
        });

        console.log(`[${win.label}] Bars: ${bars.length}, PnL: $${(totalPnlCents / 100).toFixed(2)}, WorstDD: $${(worstDd / 100).toFixed(2)}`);
      }

      const summary = summarizeWalkForward(results);
      const outData = { summary, results };
      const outJson = path.join(home, ".automaton", "walkforward.json");
      fs.mkdirSync(path.dirname(outJson), { recursive: true });
      fs.writeFileSync(outJson, JSON.stringify(outData, null, 2), "utf-8");
      console.log(`Walkforward summary written to ${outJson}`);
      console.log(`% Profitable: ${summary.pctProfitable.toFixed(1)}%, Total PnL: $${(summary.totalPnlCents / 100).toFixed(2)}`);

      expect(results.length).toBeGreaterThanOrEqual(1);
    },
    600_000,
  );
});
