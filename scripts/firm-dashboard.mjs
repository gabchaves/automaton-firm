#!/usr/bin/env node
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { firmSummary, recentOrders, traderRows } from "./dashboard/queries.mjs";
import { renderDashboardHtml } from "./dashboard/render.mjs";

function defaultDbPath() {
  return path.join(os.homedir(), ".automaton", "state.db");
}

function defaultJournalsPath() {
  return path.join(os.homedir(), ".automaton", "journals");
}

function readJournals(dir) {
  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      const content = fs.readFileSync(fullPath, "utf8");
      return {
        filename: entry.name,
        modifiedAt: stat.mtime.toISOString(),
        body: content.trim().slice(0, 200),
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 10);

  return files.map(({ mtimeMs, ...journal }) => journal);
}

function main() {
  const dbPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultDbPath();
  if (!fs.existsSync(dbPath)) {
    console.log(`Firm dashboard: database not found at ${dbPath}`);
    console.log("Run the firm once or pass a state.db path as the first argument.");
    return;
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const data = {
      summary: firmSummary(db),
      traders: traderRows(db),
      orders: recentOrders(db, 25),
      journals: readJournals(defaultJournalsPath()),
    };
    const html = renderDashboardHtml(data, new Date().toISOString());
    const outPath = path.resolve(process.cwd(), "firm-dashboard.html");
    fs.writeFileSync(outPath, html, "utf8");
    console.log(outPath);
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
