#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderLineageHTML } from "./lineage-render.mjs";

const jsonlPath = process.argv[2] || path.join(os.homedir(), ".automaton", "carry-lineage.jsonl");
const outPath = process.argv[3] || path.resolve(process.cwd(), "carry-lineage.html");

const records = [];
if (fs.existsSync(jsonlPath)) {
  for (const line of fs.readFileSync(jsonlPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      records.push(JSON.parse(t));
    } catch {
      /* skip partial trailing line */
    }
  }
}

fs.writeFileSync(outPath, renderLineageHTML(records), "utf8");
console.log(outPath);
console.log(`generations: ${records.length}, anyKept: ${records.some((r) => r.keptAsIncumbent)}`);
