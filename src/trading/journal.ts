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

export function parseJournalFile(content: string): JournalEntry | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const fm = fmMatch[1];
  const getVal = (k: string): string => {
    const m = fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m"));
    return m ? m[1].trim() : "";
  };

  const thesisMatch = content.match(/## Thesis\n([\s\S]*?)(?=\n##|$)/);
  const mistakeMatch = content.match(/## Mistake\n([\s\S]*?)(?=\n##|$)/);

  return {
    traderId: getVal("trader_id") || "unknown",
    generation: parseInt(getVal("generation") || "0", 10),
    symbol: getVal("symbol") || "BTCUSDT",
    side: (getVal("side") || "buy") as OrderSide,
    entryCents: parseInt(getVal("entry_cents") || "0", 10),
    exitCents: parseInt(getVal("exit_cents") || "0", 10),
    sizeQty: parseFloat(getVal("size_qty") || "0"),
    pnlCents: parseInt(getVal("pnl_cents") || "0", 10),
    thesis: thesisMatch ? thesisMatch[1].trim() : "",
    mistake: mistakeMatch ? mistakeMatch[1].trim() : "",
  };
}

