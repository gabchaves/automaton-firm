import { describe, it, expect } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRecords, sseFrame, createLineageServer } from "../../../scripts/lineage-server.mjs";

describe("lineage-server helpers", () => {
  it("readRecords parses JSONL and skips blank/partial lines", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "srv-"));
    const f = path.join(dir, "l.jsonl");
    fs.writeFileSync(f, JSON.stringify({ generation: 1 }) + "\n\n{bad json\n");
    const recs = readRecords(f);
    expect(recs).toHaveLength(1);
    expect(recs[0].generation).toBe(1);
  });

  it("sseFrame emits a single-line data frame under the lineage event", () => {
    const frame = sseFrame([{ generation: 1, params: {}, evalResult: {}, keptAsIncumbent: false }]);
    expect(frame.startsWith("event: lineage")).toBe(true);
    const dataLines = frame.trim().split("\n").filter((l) => l.startsWith("data:"));
    expect(dataLines).toHaveLength(1);
  });
});

describe("lineage-server GET /", () => {
  it("serves the HTML shell with 200", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "srv2-"));
    const f = path.join(dir, "l.jsonl");
    fs.writeFileSync(f, "");
    const server = createLineageServer(f);
    await new Promise((res) => server.listen(0, res));
    const port = (server.address() as import("node:net").AddressInfo).port;
    const body = await new Promise<string>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/`, (r) => {
          let d = "";
          r.on("data", (c) => (d += c));
          r.on("end", () => resolve(d));
        })
        .on("error", reject);
    });
    await new Promise((res) => server.close(res));
    expect(body).toContain("ao vivo");
  });
});
