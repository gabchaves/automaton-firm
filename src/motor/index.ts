/**
 * Motor CLI: `run` (foreground supervisor, Ctrl+C safe) and `status`.
 * Correctness never depends on uptime: tick() is idempotent and catches up.
 */
import os from "os";
import path from "path";
import { openMotorDb } from "./db.js";
import { emitEvents } from "./events.js";
import { tick } from "./tick.js";

const TICK_INTERVAL_MS = 60_000;

function defaultDbPath(): string {
  return process.env.MOTOR_DB_PATH ?? path.join(os.homedir(), ".automaton", "motor.db");
}

function fmtUsd(mc: number): string {
  return `$${(mc / 100_000).toFixed(2)}`;
}

async function runLoop(): Promise<void> {
  const db = openMotorDb(defaultDbPath());
  emitEvents(db, [{ ts: Date.now(), type: "motor_started", traderId: null, generationId: null, payload: {} }]);
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  while (!stopping) {
    try {
      const report = await tick({ db, nowMs: Date.now(), log: (l) => console.error(l) });
      const ev = db.getLiveGeneration("evolved");
      const rn = db.getLiveGeneration("random");
      console.error(
        `[motor] bars=${report.barsProcessed} gen=E${ev?.genNumber ?? "?"}/R${rn?.genNumber ?? "?"} ` +
        `record=${fmtUsd(Math.max(db.getBestEndedRecordMc("evolved"), ev?.peakEquityMc ?? 0))}`,
      );
    } catch (error) {
      console.error(`[motor] tick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((r) => setTimeout(r, TICK_INTERVAL_MS));
  }
  emitEvents(db, [{ ts: Date.now(), type: "motor_stopped", traderId: null, generationId: null, payload: {} }]);
  db.close();
}

function status(): void {
  const db = openMotorDb(defaultDbPath());
  for (const cohort of ["evolved", "random", "llm-governed"] as const) {
    const gen = db.getLiveGeneration(cohort);
    const record = db.getBestEndedRecordMc(cohort);
    console.log(`${cohort}: gen=${gen?.genNumber ?? "-"} peak=${fmtUsd(gen?.peakEquityMc ?? 0)} bestEndedRecord=${fmtUsd(record)}`);
  }
  for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT"]) {
    const cursor = db.getCursor(symbol);
    console.log(`${symbol}: lastBar=${cursor ? new Date(cursor).toISOString() : "-"}`);
  }
  db.close();
}

const cmd = process.argv[2];
if (cmd === "run") void runLoop();
else if (cmd === "status") status();
else { console.log("usage: motor <run|status>"); process.exit(1); }
