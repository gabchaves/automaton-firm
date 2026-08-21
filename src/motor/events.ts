/**
 * Motor event log contract: every event type is validated against a strict
 * Zod schema before it is persisted. This is the append-only contract the
 * future front (Palco) reads, so stray or malformed payloads must fail
 * loudly at emit time rather than silently corrupting the log.
 */

import { z } from "zod";
import type { MotorDb } from "./db.js";

const EMPTY_PAYLOAD = z.strictObject({});

const COHORT = z.enum(["evolved", "random", "llm-governed"]);

export const EVENT_PAYLOAD_SCHEMAS = {
  motor_started: EMPTY_PAYLOAD,
  motor_stopped: EMPTY_PAYLOAD,

  catch_up: z.strictObject({
    fromTs: z.number().int(),
    toTs: z.number().int(),
    bars: z.number().int(),
  }),

  gap: z.strictObject({
    fromTs: z.number().int(),
    toTs: z.number().int(),
    reason: z.string(),
  }),

  gen_started: z.strictObject({
    cohort: COHORT,
    genNumber: z.number().int(),
    seedNote: z.string(),
  }),

  gen_ended: z.strictObject({
    cohort: COHORT,
    genNumber: z.number().int(),
    peakEquityMc: z.number().int(),
    peakAt: z.number().int(),
    barsLived: z.number().int(),
    daysLived: z.number(),
    isNewRecord: z.boolean(),
    // Residual firm equity at death (books are 0, so this is the leftover
    // reserve). Recorded so no paper money ever vanishes silently — it does
    // not carry into the next generation's fresh $10.
    finalEquityMc: z.number().int(),
  }),

  record_broken: z.strictObject({
    cohort: COHORT,
    genNumber: z.number().int(),
    peakEquityMc: z.number().int(),
    previousRecordMc: z.number().int(),
  }),

  trade_opened: z.strictObject({
    symbol: z.string(),
    priceCents: z.number().int(),
    notionalMc: z.number().int(),
    feeMc: z.number().int(),
    direction: z.enum(["long", "short"]),
  }),

  trade_closed: z.strictObject({
    symbol: z.string(),
    priceCents: z.number().int(),
    realizedPnlMc: z.number().int(),
    feeMc: z.number().int(),
    liquidated: z.boolean(),
    direction: z.enum(["long", "short"]),
  }),

  trader_died: z.strictObject({
    name: z.string(),
    slot: z.number().int(),
    ageMs: z.number().int(),
    bookPeakMc: z.number().int(),
  }),

  trader_fired: z.strictObject({
    name: z.string(),
    reason: z.string(),
    returnedMc: z.number().int(),
  }),

  // Evidence-blind seat rotation (HR plan, "exploration pressure"): NEVER a
  // performance judgment — age + lifetime trade-count gate only. Same shape
  // as trader_fired (roster mechanics are identical) but its own type so the
  // front never has to guess intent from the reason string.
  trader_rotated: z.strictObject({
    name: z.string(),
    reason: z.string(),
    returnedMc: z.number().int(),
  }),

  trader_hired: z.strictObject({
    name: z.string(),
    slot: z.number().int(),
    stakeMc: z.number().int(),
    parentTraderId: z.string().nullable(),
  }),

  trader_promoted: z.strictObject({
    name: z.string(),
    title: z.string(),
  }),

  hr_review: z.strictObject({
    reviewed: z.number().int(),
    fired: z.number().int(),
    promoted: z.number().int(),
    held: z.number().int(),
    benchmarkCents: z.number().int(),
  }),

  achievement: z.strictObject({
    key: z.string(),
    name: z.string(),
    label: z.string(),
  }),
} satisfies Record<string, z.ZodType>;

export type MotorEventType = keyof typeof EVENT_PAYLOAD_SCHEMAS;

export interface MotorEventDraft {
  ts: number;
  type: MotorEventType;
  traderId: string | null;
  generationId: string | null;
  payload: Record<string, unknown>;
}

export function emitEvents(db: MotorDb, drafts: MotorEventDraft[]): void {
  for (const draft of drafts) {
    const schema = EVENT_PAYLOAD_SCHEMAS[draft.type];
    if (!schema) throw new Error(`unknown motor event type: ${draft.type}`);
    schema.parse(draft.payload); // validate ALL before inserting ANY
  }
  for (const draft of drafts) {
    db.insertEvent({
      ts: draft.ts,
      type: draft.type,
      traderId: draft.traderId,
      generationId: draft.generationId,
      payloadJson: JSON.stringify(draft.payload),
    });
  }
}
