import nodePath from "node:path";
import type { OrderSide } from "./types.js";

export interface JournalEntry {
  traderId: string;
  generation: number;
  symbol: string;
  side: OrderSide;
  entryCents: number;
  exitCents: number;
  sizeQty: number;
  pnlCents: number;
  thesis: string;
  mistake: string;
}

export function renderJournal(e: JournalEntry, at: string): string {
  const fm = [
    "---",
    `trader_id: ${e.traderId}`,
    `generation: ${e.generation}`,
    `symbol: ${e.symbol}`,
    `side: ${e.side}`,
    `entry_cents: ${e.entryCents}`,
    `exit_cents: ${e.exitCents}`,
    `size_qty: ${e.sizeQty}`,
    `pnl_cents: ${e.pnlCents}`,
    `at: ${at}`,
    "---",
    "",
    `## Thesis`,
    e.thesis,
    "",
    `## Mistake`,
    e.mistake,
    "",
  ].join("\n");
  return fm;
}

export function journalPath(homeDir: string, traderId: string, at: string): string {
  const stamp = at.replace(/[:.]/g, "-");
  return nodePath.join(homeDir, ".automaton", "journals", `${traderId}-${stamp}.md`);
}
