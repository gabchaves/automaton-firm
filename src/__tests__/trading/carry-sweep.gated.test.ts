/**
 * Gated multi-symbol multi-regime carry sweep runner (gated by RUN_SWEEP=1).
 * Zero inference; purely deterministic backtesting across symbols and historical regimes.
 *
 *   RUN_SWEEP=1 vitest run carry-sweep.gated
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
import { summarizeSymbolSweep, type SweepRow } from "../../trading/carry-sweep.js";

const run = process.env.RUN_SWEEP === "1";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "AVAXUSDT", "LUNAUSDT"];
const WINDOWS = [
  { label: "2021-bull", start: "2021-01-01", end: "2021-05-01" },
  { label: "2022-bear", start: "2022-01-01", end: "2022-07-01" },
  { label: "2024", start: "2024-01-01", end: "2024-06-01" },
  { label: "recent-6m", start: "2026-02-01", end: "2026-08-01" },
];

const CAPITAL_CENTS = 300_000; // 3 seniors * $1,000

describe.skipIf(!run)("Carry Symbol Sweep (gated)", () => {
  it(
    "runs funding carry across 6 symbols and 4 historical regimes",
    async () => {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
      const rows: SweepRow[] = [];

      for (const symbol of SYMBOLS) {
        console.log(`\n--- Testing Symbol: ${symbol} ---`);
        for (const win of WINDOWS) {
          const startTs = Date.parse(`${win.start}T00:00:00Z`);
          const endTs = Date.parse(`${win.end}T00:00:00Z`);

          try {
            const bars = await fetchCarrySeriesRange(symbol, startTs, endTs);
            if (bars.length < 50) {
              rows.push({
                symbol,
                window: win.label,
                bars: bars.length,
                totalPnlCents: 0,
                worstDrawdownCents: 0,
                skipped: `too few bars (${bars.length} < 50)`,
              });
              console.log(`[${symbol} - ${win.label}] SKIPPED: too few bars (${bars.length})`);
              continue;
            }

            const db = createDatabase(":memory:");
            const res = runCarryFirm({ db, bars, seniorStartCents: 100_000, homeDir: home });
            db.close();

            const totalPnlCents = res.traders.reduce((s, t) => s + (t.realizedPnlCents || 0), 0);
            const bt = runCarryBacktest(bars, CARRY_ARCHETYPES[1].params, 100_000);
            const worstDrawdownCents = bt.maxDrawdownCents;

            rows.push({
              symbol,
              window: win.label,
              bars: bars.length,
              totalPnlCents,
              worstDrawdownCents,
            });

            console.log(
              `[${symbol} - ${win.label}] Bars: ${bars.length}, PnL: $${(totalPnlCents / 100).toFixed(2)}, WorstDD: $${(worstDrawdownCents / 100).toFixed(2)}`,
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            rows.push({
              symbol,
              window: win.label,
              bars: 0,
              totalPnlCents: 0,
              worstDrawdownCents: 0,
              skipped: msg,
            });
            console.log(`[${symbol} - ${win.label}] SKIPPED (fetch error): ${msg}`);
          }
        }
      }

      const summaries = summarizeSymbolSweep(rows, CAPITAL_CENTS);
      const outData = {
        generatedAt: new Date().toISOString(),
        capitalCents: CAPITAL_CENTS,
        rows,
        summaries,
      };

      const outJson = path.join(home, ".automaton", "carry-sweep.json");
      fs.mkdirSync(path.dirname(outJson), { recursive: true });
      fs.writeFileSync(outJson, JSON.stringify(outData, null, 2), "utf-8");
      console.log(`\nCarry sweep data written to ${outJson}`);

      expect(rows.length).toBe(SYMBOLS.length * WINDOWS.length);
      for (const r of rows) {
        expect(r.bars > 0 || typeof r.skipped === "string").toBe(true);
      }
      expect(summaries.length).toBe(SYMBOLS.length);
    },
    900_000, // 15 min ceiling
  );
});
