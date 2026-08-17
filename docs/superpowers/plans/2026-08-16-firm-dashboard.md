# Firm Dashboard — Short Plan (read-only monitoring)

**Goal:** A dead-simple, self-contained HTML view to follow the trading firm — who's alive, each book's balance and realized PnL, recent orders, and recent journals. Snapshot model: run a script → open the HTML → re-run to refresh.

**Why now:** The schema is stable (v13) and there's real firm state to show. This is read-only observability; it changes no trading behavior.

## Hard rules for the executor

- **READ-ONLY.** This must never write to `state.db` or mutate any firm state. Only `SELECT` queries and file reads.
- **Do NOT touch** `src/trading/`, `src/agent/`, `src/heartbeat/`, `src/state/`, policy rules, or any trading logic. This is additive: one script + one test.
- **Node 22.** Run tests with vitest as elsewhere; the repo has 19 pre-existing failing tests that are not yours.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## What it reads

- SQLite DB at `~/.automaton/state.db` (override via first CLI arg). Tables: `traders`, `orders`, `positions`, `fills`.
- Journals: `~/.automaton/journals/*.md` (may be absent — handle gracefully).

## What it shows (one HTML page)

1. **Firm summary:** live seniors, live interns, dead count, total realized PnL (sum of `traders.realized_pnl_cents`), total book cash (sum of `book_balance_cents` for live traders).
2. **Traders table:** id (short), name, role, generation, status, book balance ($), realized PnL ($), parent id. Sort: live first, then by realized PnL desc. Color PnL green/red.
3. **Recent orders:** last 25 from `orders` (join not needed) — time, trader (short), symbol, side, qty, price ($), status. Rejected rows dimmed.
4. **Recent journals:** last 10 journal files by mtime — filename, first ~200 chars of the body.

All money is integer cents in the DB → divide by 100 for display. Self-contained HTML: inline `<style>`, no external assets, works offline. Include a "generated at" timestamp (pass it in from the script; do not call Date inside query helpers if you unit-test them).

---

## Task 1: Query helpers (pure, testable)

**Files:**
- Create: `scripts/dashboard/queries.mjs`
- Test: `src/__tests__/dashboard/queries.test.ts`

**Produces:**
```js
export function firmSummary(db)      // { liveSeniors, liveInterns, dead, totalRealizedPnlCents, totalBookCents }
export function traderRows(db)       // array of trader rows (camelCase), sorted live-first then PnL desc
export function recentOrders(db, n)  // last n orders, newest first
```
Each takes a `better-sqlite3` Database and returns plain data (no HTML).

- [ ] **Step 1: Failing test** — create an in-memory DB via `createDatabase(":memory:")` from `../../state/database.js`, insert 2 traders (one senior with realized_pnl_cents 1500, one dead) via `insertTrader` from `../../trading/repo.js` (remember the required `realizedPnlCents` field), then assert `firmSummary(db.raw).liveSeniors === 1` and `traderRows(db.raw)[0].role === "senior"`. Run: `pnpm test -- dashboard/queries` → FAIL.
- [ ] **Step 2: Implement `queries.mjs`** with plain `db.prepare(...).all()/get()` SELECTs. Map snake_case → camelCase. No writes.
- [ ] **Step 3:** Run → PASS. `pnpm run typecheck`. Commit.

## Task 2: HTML renderer + CLI entry

**Files:**
- Create: `scripts/dashboard/render.mjs` — `renderDashboardHtml(data, generatedAt)` → string of a full self-contained HTML document.
- Create: `scripts/firm-dashboard.mjs` — CLI: open DB (arg or `~/.automaton/state.db`), call the query helpers, read journals dir, call `renderDashboardHtml`, write `firm-dashboard.html` in cwd, print the absolute path.
- Test: `src/__tests__/dashboard/render.test.ts`

- [ ] **Step 1: Failing test** — `renderDashboardHtml({ summary: {...}, traders: [...], orders: [], journals: [] }, "2026-08-16T00:00:00Z")` returns a string containing `<!doctype html`, the trader's name, and a `$`-formatted PnL. Run → FAIL.
- [ ] **Step 2: Implement `render.mjs`** — template literal producing valid HTML with inline CSS (a readable table layout, green/red PnL, dark-friendly is a plus but optional). Escape any text taken from journals/names (basic `&<>` escape) since journal content is model-written.
- [ ] **Step 3: Implement `firm-dashboard.mjs`** — wire DB + journals + render + write file. Guard: if the DB file doesn't exist, print a clear message and exit 0 (don't crash).
- [ ] **Step 4:** Run test → PASS. Manually run `node scripts/firm-dashboard.mjs` against a seeded DB and open the HTML to eyeball it. Commit.

## Task 3: Convenience + docs

- [ ] Add an npm script to `package.json`: `"dashboard": "node scripts/firm-dashboard.mjs"`.
- [ ] Add a 3-line usage note to the README (or a `scripts/dashboard/README.md`): what it shows, how to run, that it's read-only and snapshot-based.
- [ ] Commit.

## Verification (executor reports back)

- `pnpm test -- dashboard` green.
- `node scripts/firm-dashboard.mjs` produces `firm-dashboard.html` that opens in a browser and shows the seeded/live firm state.
- Confirm no file under `src/trading|agent|heartbeat|state` was modified.

## Not in scope

Live auto-refresh server, charts/graphs over time, editing state, auth. If auto-refresh is wanted later, wrap the same helpers in a tiny local server as a follow-up — the snapshot script stays the foundation.
