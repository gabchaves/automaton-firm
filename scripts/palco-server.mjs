#!/usr/bin/env node
/**
 * Palco SSE server: serves the built React front from `distDir` and pushes
 * `PalcoSnapshot`s over `/api/snapshot` (one-shot) and `/events` (SSE) by
 * reading `~/.automaton/motor.db` READ-ONLY. Palco never writes to the DB.
 *
 * Uso: node scripts/palco-server.mjs [--db path] [--port n] [--dist path]
 * Requer Node 22 (better-sqlite3).
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { buildSnapshot } from "../dist/motor/palco-data.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(SCRIPT_DIR, "..");

const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function lastEventIdOf(db) {
  const row = db.prepare("SELECT MAX(id) AS m FROM events").get();
  return row.m ?? 0;
}

function handleSnapshot(res, db) {
  sendJson(res, 200, buildSnapshot(db, Date.now()));
}

function handleEvents(req, res, db, activeStreams) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sendSnapshot = () => {
    res.write(`data: ${JSON.stringify(buildSnapshot(db, Date.now()))}\n\n`);
  };

  sendSnapshot(); // immediate full snapshot on connect
  let lastSeenId = lastEventIdOf(db);

  const pollTimer = setInterval(() => {
    const currentId = lastEventIdOf(db);
    if (currentId !== lastSeenId) {
      lastSeenId = currentId;
      sendSnapshot();
    }
  }, POLL_INTERVAL_MS);

  const heartbeatTimer = setInterval(() => {
    res.write(":hb\n\n");
  }, HEARTBEAT_INTERVAL_MS);

  const cleanup = () => {
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    activeStreams.delete(res);
  };

  activeStreams.add(res);
  req.on("close", cleanup);
  res.on("close", cleanup);
}

/** Resolve a request path under distDir, refusing to escape it. */
function resolveStaticPath(distDir, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const withoutQuery = decoded.split("?")[0];
  const relative = withoutQuery === "/" ? "index.html" : withoutQuery.replace(/^\/+/, "");
  const filePath = path.join(distDir, relative);
  const distRoot = path.resolve(distDir);
  if (!path.resolve(filePath).startsWith(distRoot)) return null; // traversal guard
  return filePath;
}

function serveStatic(req, res, distDir) {
  const indexPath = path.join(distDir, "index.html");
  if (!fs.existsSync(distDir) || !fs.existsSync(indexPath)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("rode pnpm palco:build");
    return;
  }

  const filePath = resolveStaticPath(distDir, req.url ?? "/");
  const ext = filePath ? path.extname(filePath) : "";
  const contentType = CONTENT_TYPES[ext];

  if (filePath && contentType && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // SPA fallback: unknown paths (client routes, missing assets) get index.html.
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  fs.createReadStream(indexPath).pipe(res);
}

/**
 * Starts the Palco server. Read-only over motor.db — never writes.
 * @param {{ dbPath: string, port: number, distDir: string }} opts
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export async function startPalcoServer({ dbPath, port, distDir }) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const activeStreams = new Set();

  const server = http.createServer((req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && urlPath === "/api/snapshot") {
      handleSnapshot(res, db);
      return;
    }
    if (req.method === "GET" && urlPath === "/events") {
      handleEvents(req, res, db, activeStreams);
      return;
    }
    serveStatic(req, res, distDir);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve(undefined);
    });
  });

  const actualPort = server.address().port;

  const close = () =>
    new Promise((resolve, reject) => {
      for (const streamRes of activeStreams) {
        if (!streamRes.writableEnded) streamRes.end();
      }
      activeStreams.clear();
      server.close((err) => {
        try {
          db.close();
        } catch {
          /* already closed */
        }
        if (err) reject(err);
        else resolve(undefined);
      });
    });

  return { port: actualPort, close };
}

function parseArgs(argv) {
  const result = {
    dbPath: path.join(os.homedir(), ".automaton", "motor.db"),
    port: 4242,
    distDir: path.join(REPO_ROOT, "packages", "palco", "dist"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--db") {
      result.dbPath = argv[++i]; // consume the value so it is not mistaken for a flag
    } else if (arg === "--port") {
      result.port = Number(argv[++i]);
    } else if (arg === "--dist") {
      result.distDir = argv[++i];
    }
  }
  return result;
}

async function main() {
  const { dbPath, port, distDir } = parseArgs(process.argv.slice(2));
  const { port: actualPort } = await startPalcoServer({ dbPath, port, distDir });
  console.log(`Palco server live at http://localhost:${actualPort}/ (db: ${dbPath}, dist: ${distDir})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
