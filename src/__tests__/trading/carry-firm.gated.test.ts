/**
 * Live carry firm over a high-funding historical window (gated by RUN_CARRY_FIRM=1).
 * Fetches a real 2021-era window (high perp funding), runs the firm into
 * ~/.automaton/carry-firm.db, and writes the stats sidecar. Render with:
 *   node scripts/carry-firm-dashboard.mjs
 *
 *   RUN_CARRY_FIRM=1 vitest run carry-firm.gated
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import { fetchCarrySeriesRange } from "../../trading/funding-feed.js";
import { runCarryFirm } from "../../trading/carry-firm.js";
import { createDatabase } from "../../state/database.js";

const run = process.env.RUN_CARRY_FIRM === "1";

describe.skipIf(!run)("Live carry firm (gated)", () => {
  it(
    "runs the firm over a high-funding window and writes the roster db",
    async () => {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
      const dbPath = path.join(home, ".automaton", "carry-firm.db");
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.rmSync(dbPath, { force: true });

      // 2021 bull: perp funding ran hot (5-30 bps/8h). Jan–May 2021.
      const start = Date.parse("2021-01-01T00:00:00Z");
      const end = Date.parse("2021-05-01T00:00:00Z");
      const bars = await fetchCarrySeriesRange("BTCUSDT", start, end);
      expect(bars.length).toBeGreaterThan(100);
      const hot = bars.filter((b) => b.fundingRate * 10000 >= 2).length;
      console.log(`Carry firm window: ${bars.length} bars, ${hot} with funding >= 2 bp`);

      const db = createDatabase(dbPath);
      const res = runCarryFirm({ db, bars, seniorStartCents: 100_000, homeDir: home });
      db.close();

      const seniors = res.traders.filter((t) => t.role === "senior");
      const interns = res.traders.filter((t) => t.role === "intern");
      const totalPnl = res.traders.reduce((s, t) => s + t.realizedPnlCents, 0);
      console.log(`Roster: ${seniors.length} seniors, ${interns.length} interns, total realized PnL $${(totalPnl / 100).toFixed(2)}`);
      console.log(`Render: node scripts/carry-firm-dashboard.mjs`);
      expect(res.traders.length).toBeGreaterThanOrEqual(3);
    },
    600_000,
  );
});
