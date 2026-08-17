#!/usr/bin/env node
/**
 * Curate Journals CLI
 * Reads all journal files from ~/.automaton/journals, parses their frontmatter,
 * and prints an aggregated summary of outcomes, theses, and mistakes to guide
 * human curation for the next generation's strategy.
 */
import fs from "node:fs";
import path from "node:path";
import { aggregateJournals } from "../dist/trading/journal-aggregate.js";

const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
const journalsDir = path.join(home, ".automaton", "journals");

if (!fs.existsSync(journalsDir)) {
  console.log(`No journals directory found at ${journalsDir}`);
  process.exit(0);
}

const files = fs.readdirSync(journalsDir).filter((f) => f.endsWith(".md"));
if (files.length === 0) {
  console.log(`No journal files found in ${journalsDir}`);
  process.exit(0);
}

const entries = [];

for (const file of files) {
  try {
    const content = fs.readFileSync(path.join(journalsDir, file), "utf-8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    const fm = fmMatch[1];
    const getVal = (k) => {
      const m = fm.match(new RegExp(`^${k}:\\s*(.*)$`, "m"));
      return m ? m[1].trim() : "";
    };

    const thesisMatch = content.match(/## Thesis\n([\s\S]*?)(?=\n##|$)/);
    const mistakeMatch = content.match(/## Mistake\n([\s\S]*?)(?=\n##|$)/);

    entries.push({
      traderId: getVal("trader_id") || "unknown",
      generation: parseInt(getVal("generation") || "0", 10),
      symbol: getVal("symbol") || "BTCUSDT",
      side: getVal("side") || "buy",
      entryCents: parseInt(getVal("entry_cents") || "0", 10),
      exitCents: parseInt(getVal("exit_cents") || "0", 10),
      sizeQty: parseFloat(getVal("size_qty") || "0"),
      pnlCents: parseInt(getVal("pnl_cents") || "0", 10),
      thesis: thesisMatch ? thesisMatch[1].trim() : "",
      mistake: mistakeMatch ? mistakeMatch[1].trim() : "",
    });
  } catch (err) {
    // skip malformed file
  }
}

const summary = aggregateJournals(entries);

console.log("==========================================");
console.log("       TRADING FIRM JOURNAL SUMMARY       ");
console.log("==========================================");
console.log(`Total Closed Trades: ${summary.totalTrades}`);
console.log(`Win / Loss:          ${summary.winCount} W / ${summary.lossCount} L (${(summary.winRate * 100).toFixed(1)}% win rate)`);
console.log(`Total Realized PnL:  $${(summary.totalPnlCents / 100).toFixed(2)} (${summary.totalPnlCents} cents)`);
console.log("------------------------------------------");
console.log("Top Identified Mistakes:");
if (summary.mistakes.length === 0) {
  console.log("  (None recorded)");
} else {
  for (const m of summary.mistakes) {
    console.log(`  - [${m.count}x] ${m.mistake}`);
  }
}
console.log("------------------------------------------");
console.log("Recent Theses:");
if (summary.theses.length === 0) {
  console.log("  (None recorded)");
} else {
  for (const t of summary.theses.slice(-5)) {
    console.log(`  - "${t}"`);
  }
}
console.log("==========================================");
