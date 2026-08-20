/**
 * Palco SSE server: serves the built React front from `distDir` and pushes
 * `PalcoSnapshot`s over `/api/snapshot` (one-shot) and `/events` (SSE) by
 * reading `~/.automaton/motor.db` READ-ONLY. Palco never writes to the DB.
 *
 * Uso: node scripts/palco-server.mjs [--db path] [--port n] [--dist path]
 * Requer Node 22 (better-sqlite3).
 *
 * No shebang line on purpose: this file is always invoked as `node
 * scripts/palco-server.mjs ...` (see the usage line above and every test/
 * caller in this repo), never executed directly, and a leading `#!/usr/bin/
 * env node` breaks Vitest's SSR module transform for anything that imports
 * this file (src/__tests__/motor/palco-server.test.ts) — the parser trips
 * on the hashbang and mis-reports a syntax error in the IMPORTING file
 * instead. Confirmed via `node --check` (fine) vs. importing under Vitest
 * (fails) with/without the shebang line.
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { buildSnapshot, fetchFeedPage } from "../dist/motor/palco-data.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(SCRIPT_DIR, "..");

const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

// v4.2 Task 2b: GET /api/feed pagination defaults/cap — "carregar mais" in
// the Mural asks for DEFAULT_FEED_LIMIT items per click; MAX_FEED_LIMIT is
// a defensive ceiling against an abusive/typo'd ?limit= value, never
// reachable through the front's own UI.
const DEFAULT_FEED_LIMIT = 20;
const MAX_FEED_LIMIT = 100;

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

/** Strict positive-integer query-param parser: `undefined` for a param that
 * wasn't supplied at all (caller decides whether that's an error or a
 * default), `null` for one that WAS supplied but isn't a positive integer
 * (caller responds 400). Deliberately stricter than `Number()` — that
 * would silently accept "12px", "", " ", or "-5" as numbers. */
function parsePositiveIntParam(raw) {
  if (raw === null) return undefined;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * GET /api/feed?before=<eventId>&limit=<n> — an older page of the Mural
 * feed for the "carregar mais" control (v4.2 Task 2b). `before` is
 * required (there's no sane "give me older than nothing" default); `limit`
 * defaults to DEFAULT_FEED_LIMIT and is capped at MAX_FEED_LIMIT. Same
 * read-only db, same JSON envelope style as handleSnapshot.
 */
function handleFeed(res, db, query) {
  const beforeId = parsePositiveIntParam(query.get("before"));
  if (beforeId === undefined || beforeId === null) {
    sendJson(res, 400, { error: "'before' query param is required and must be a positive integer event id" });
    return;
  }

  const rawLimit = parsePositiveIntParam(query.get("limit"));
  if (rawLimit === null) {
    sendJson(res, 400, { error: "'limit' query param must be a positive integer" });
    return;
  }
  const limit = Math.min(rawLimit ?? DEFAULT_FEED_LIMIT, MAX_FEED_LIMIT);

  sendJson(res, 200, { feed: fetchFeedPage(db, { beforeId, limit }) });
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
  // Traversal guard: path.relative never begins with ".." only when the
  // target is inside distRoot. A bare startsWith(distRoot) would also accept
  // SIBLINGS whose name shares the prefix (e.g. dist-types/ next to dist/).
  const rel = path.relative(distRoot, path.resolve(filePath));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
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
    if (req.method === "GET" && urlPath === "/api/feed") {
      const query = new URL(req.url ?? "/", "http://localhost").searchParams;
      handleFeed(res, db, query);
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
