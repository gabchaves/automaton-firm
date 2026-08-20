import { afterEach, describe, expect, test } from "vitest";
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "../../motor/db.js";
import type { MotorDb } from "../../motor/db.js";
import { startPalcoServer } from "../../../scripts/palco-server.mjs";

interface PalcoServerHandle {
  port: number;
  close: () => Promise<void>;
}

let db: MotorDb | null = null;
let dir: string | null = null;

function freshDbPath(): string {
  dir = mkdtempSync(join(tmpdir(), "motor-palco-server-"));
  const dbPath = join(dir, "motor.db");
  db = openMotorDb(dbPath);
  return dbPath;
}

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  db = null;
  dir = null;
});

function get(port: number, urlPath: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      })
      .on("error", reject);
  });
}

/** Reads only the first chunk of an SSE stream, then aborts the request. */
function getFirstChunk(port: number, urlPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      res.once("data", (chunk) => {
        resolve(chunk.toString());
        req.destroy();
      });
      res.on("error", () => {
        /* expected once we destroy the request */
      });
    });
    req.on("error", () => {
      /* expected once we destroy the request */
    });
  });
}

describe("startPalcoServer", () => {
  test("/api/snapshot returns JSON with cards, no-store", async () => {
    const dbPath = freshDbPath();
    db!.insertGeneration({
      id: "g1", cohort: "evolved", genNumber: 1, startedAt: 0, endedAt: null,
      peakEquityMc: 1_000_000, peakAt: 0, barsLived: 0, seedNote: "fresh",
    });
    db!.insertEvent({
      ts: 0, type: "gen_started", traderId: null, generationId: "g1",
      payloadJson: JSON.stringify({ cohort: "evolved", genNumber: 1, seedNote: "fresh" }),
    });

    const server = (await startPalcoServer({
      dbPath, port: 0, distDir: join(dir!, "no-such-dist"),
    })) as PalcoServerHandle;

    try {
      const res = await get(server.port, "/api/snapshot");
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const snapshot = JSON.parse(res.body);
      expect(snapshot.cards).toBeDefined();
      expect(snapshot.cards.evolvedGen).toBe(1);
    } finally {
      await server.close();
    }
  });

  test("/events yields a data: line whose JSON parses into a snapshot", async () => {
    const dbPath = freshDbPath();
    db!.insertGeneration({
      id: "g1", cohort: "evolved", genNumber: 1, startedAt: 0, endedAt: null,
      peakEquityMc: 1_000_000, peakAt: 0, barsLived: 0, seedNote: "fresh",
    });

    const server = (await startPalcoServer({
      dbPath, port: 0, distDir: join(dir!, "no-such-dist"),
    })) as PalcoServerHandle;

    try {
      const chunk = await getFirstChunk(server.port, "/events");
      const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
      expect(dataLine).toBeDefined();
      const parsed = JSON.parse(dataLine!.slice("data:".length).trim());
      expect(parsed.cards).toBeDefined();
      expect(parsed.cards.evolvedGen).toBe(1);
    } finally {
      await server.close();
    }
  });

  test("traversal guard: encoded ../ cannot reach a prefix-sharing sibling of dist", async () => {
    const dbPath = freshDbPath();
    const distDir = join(dir!, "dist");
    const sibling = join(dir!, "dist-secrets"); // shares the "dist" prefix on purpose
    mkdirSync(distDir);
    mkdirSync(sibling);
    writeFileSync(join(distDir, "index.html"), "<html>palco</html>");
    writeFileSync(join(sibling, "leak.js"), "SECRET_CONTENT");

    const server = (await startPalcoServer({ dbPath, port: 0, distDir })) as PalcoServerHandle;
    try {
      const res = await get(server.port, "/..%2Fdist-secrets%2Fleak.js");
      expect(res.body).not.toContain("SECRET_CONTENT");
    } finally {
      await server.close();
    }
  });

  test("/api/feed returns an older page, newest-first, bounded by limit", async () => {
    const dbPath = freshDbPath();
    for (let i = 0; i < 45; i++) {
      db!.insertEvent({
        ts: 1000 + i, type: "catch_up", traderId: null, generationId: null,
        payloadJson: JSON.stringify({ fromTs: 0, toTs: 1, bars: i }),
      });
    }
    // ids 1..45 (bars 0..44), same AUTOINCREMENT reasoning as palco-data.test.ts.

    const server = (await startPalcoServer({
      dbPath, port: 0, distDir: join(dir!, "no-such-dist"),
    })) as PalcoServerHandle;

    try {
      const res = await get(server.port, "/api/feed?before=41&limit=5");
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const body = JSON.parse(res.body) as { feed: { id: number }[] };
      expect(body.feed.map((e) => e.id)).toEqual([40, 39, 38, 37, 36]);
    } finally {
      await server.close();
    }
  });

  test("/api/feed defaults to a limit of 20 and caps an oversized limit at 100", async () => {
    const dbPath = freshDbPath();
    for (let i = 0; i < 150; i++) {
      db!.insertEvent({
        ts: 1000 + i, type: "catch_up", traderId: null, generationId: null,
        payloadJson: JSON.stringify({ fromTs: 0, toTs: 1, bars: i }),
      });
    }
    // ids 1..150 -> beforeId 151 sees every one of them as "older".

    const server = (await startPalcoServer({
      dbPath, port: 0, distDir: join(dir!, "no-such-dist"),
    })) as PalcoServerHandle;

    try {
      const defaultRes = await get(server.port, "/api/feed?before=151");
      const defaultBody = JSON.parse(defaultRes.body) as { feed: unknown[] };
      expect(defaultBody.feed.length).toBe(20);

      const cappedRes = await get(server.port, "/api/feed?before=151&limit=500");
      const cappedBody = JSON.parse(cappedRes.body) as { feed: unknown[] };
      expect(cappedBody.feed.length).toBe(100);
    } finally {
      await server.close();
    }
  });

  test("/api/feed responds 400 on a missing or non-numeric 'before', or a non-numeric 'limit'", async () => {
    const dbPath = freshDbPath();
    db!.insertEvent({
      ts: 0, type: "catch_up", traderId: null, generationId: null,
      payloadJson: JSON.stringify({ fromTs: 0, toTs: 1, bars: 1 }),
    });

    const server = (await startPalcoServer({
      dbPath, port: 0, distDir: join(dir!, "no-such-dist"),
    })) as PalcoServerHandle;

    try {
      const missingBefore = await get(server.port, "/api/feed");
      expect(missingBefore.status).toBe(400);

      const nonNumericBefore = await get(server.port, "/api/feed?before=abc");
      expect(nonNumericBefore.status).toBe(400);

      const negativeBefore = await get(server.port, "/api/feed?before=-5");
      expect(negativeBefore.status).toBe(400);

      const nonNumericLimit = await get(server.port, "/api/feed?before=10&limit=xyz");
      expect(nonNumericLimit.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  test("missing dist directory returns 503 asking to build", async () => {
    const dbPath = freshDbPath();

    const server = (await startPalcoServer({
      dbPath, port: 0, distDir: join(dir!, "no-such-dist"),
    })) as PalcoServerHandle;

    try {
      const res = await get(server.port, "/");
      expect(res.status).toBe(503);
      expect(res.body).toContain("pnpm palco:build");
    } finally {
      await server.close();
    }
  });
});
