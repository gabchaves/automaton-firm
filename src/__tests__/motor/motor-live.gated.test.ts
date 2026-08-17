import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "../../motor/db.js";
import { tick } from "../../motor/tick.js";

const gate = process.env.RUN_MOTOR_LIVE === "1" ? describe : describe.skip;

gate("motor live (real Binance data, RUN_MOTOR_LIVE=1)", () => {
  test("bootstraps against the live API and processes real bars", async () => {
    const dir = mkdtempSync(join(tmpdir(), "motor-live-"));
    const db = openMotorDb(join(dir, "motor.db"));
    try {
      const report = await tick({ db, nowMs: Date.now() });
      expect(report.barsProcessed).toBeGreaterThan(0);
      expect(db.getLiveGeneration("evolved")).not.toBeNull();
      const second = await tick({ db, nowMs: Date.now() });
      expect(second.barsProcessed).toBeLessThan(report.barsProcessed);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
