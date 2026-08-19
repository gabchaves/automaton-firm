import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "../../motor/db.js";
import type { MotorDb } from "../../motor/db.js";
import { emitEvents } from "../../motor/events.js";
import { traderName } from "../../motor/names.js";

let db: MotorDb;
let dir: string;

function fresh(): MotorDb {
  dir = mkdtempSync(join(tmpdir(), "motor-ev-"));
  db = openMotorDb(join(dir, "motor.db"));
  return db;
}
afterEach(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("emitEvents", () => {
  test("valid drafts are inserted with serialized payloads, in order", () => {
    const d = fresh();
    emitEvents(d, [
      { ts: 1, type: "gen_started", traderId: null, generationId: "g1", payload: { cohort: "evolved", genNumber: 1, seedNote: "fresh" } },
      { ts: 2, type: "trade_opened", traderId: "t1", generationId: "g1", payload: { symbol: "BTCUSDT", priceCents: 10_000, notionalMc: 600_000, feeMc: 600 } },
    ]);
    const rows = d.listEvents(0, 10);
    expect(rows.map((r) => r.type)).toEqual(["gen_started", "trade_opened"]);
    expect(JSON.parse(rows[1].payloadJson).priceCents).toBe(10_000);
  });

  test("an invalid payload throws and inserts nothing", () => {
    const d = fresh();
    expect(() =>
      emitEvents(d, [{ ts: 1, type: "gen_started", traderId: null, generationId: "g1", payload: { wrong: true } }]),
    ).toThrow();
    expect(d.listEvents(0, 10).length).toBe(0);
  });

  test("unknown event type throws", () => {
    const d = fresh();
    expect(() =>
      emitEvents(d, [{ ts: 1, type: "nonsense" as never, traderId: null, generationId: null, payload: {} }]),
    ).toThrow();
  });

  test("trader_rotated payload validates (same shape as trader_fired, its own type)", () => {
    const d = fresh();
    emitEvents(d, [
      {
        ts: 1, type: "trader_rotated", traderId: "t1", generationId: "g1",
        payload: { name: "Fê Ramos", reason: "Rotação por falta de evidência: 5 dias sem gerar trades avaliáveis. Sem julgamento — a cadeira precisa produzir informação.", returnedMc: 200_000 },
      },
    ]);
    const rows = d.listEvents(0, 10);
    expect(rows.map((r) => r.type)).toEqual(["trader_rotated"]);
    expect(JSON.parse(rows[0].payloadJson).returnedMc).toBe(200_000);
  });

  test("trader_rotated rejects an unknown extra field (strict schema)", () => {
    const d = fresh();
    expect(() =>
      emitEvents(d, [
        { ts: 1, type: "trader_rotated", traderId: "t1", generationId: "g1", payload: { name: "X", reason: "Y", returnedMc: 1, extra: true } },
      ]),
    ).toThrow();
    expect(d.listEvents(0, 10).length).toBe(0);
  });
});

describe("traderName", () => {
  test("deterministic and human-shaped", () => {
    expect(traderName(5)).toBe(traderName(5));
    expect(traderName(5)).not.toBe(traderName(6));
    expect(traderName(5)).toMatch(/^[A-ZÀ-Ú][\p{L}]+ [A-ZÀ-Ú][\p{L}]+$/u);
  });
});
