# Palco (React/PrimeReact Live Front) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A realtime local front for the Motor: React 18 + PrimeReact tabs (Pregão / Gerações / Leaderboard / Mural) in the Harvey editorial identity, fed by an SSE server that pushes full `PalcoSnapshot`s from `~/.automaton/motor.db` (read-only).

**Architecture:** Tested data layer in `src/motor/` (`palco-format.ts`, `palco-data.ts`); Vite + React + PrimeReact workspace app in `packages/palco/`; thin Node server `scripts/palco-server.mjs` serving the built app + `/api/snapshot` + `/events` SSE.

**Tech Stack:** Node 22 (better-sqlite3), TypeScript ESM, vitest; React 18, PrimeReact 10, chart.js 4 + react-chartjs-2, Vite 5.

**Spec:** `docs/superpowers/specs/2026-08-17-palco-live-front-design.md`

## Global Constraints

- ESM `.js` import specifiers in `src/`; tests under `src/__tests__/motor/` (repo vitest glob).
- Palco NEVER writes to motor.db — read-only connections only.
- No `Math.random`; no `Date.now()` inside `src/motor/palco-*.ts` (`nowMs` is a parameter); the server and React app may use wall time.
- All HTML strings escape payload values at the format boundary (`escapeHtml`), no exceptions.
- No external requests at runtime: all assets bundled; fonts are the Georgia/system serif stack.
- Harvey tokens everywhere: `--ivory:#f6f4ee --ink:#232320 --green:#1e3d2f --green-soft:#2e5c46 --rule:#d8d4c8 --muted:#7a7768`; serif display, Verdana small-caps labels.
- better-sqlite3 tests run under fnm Node 22.23.2 (prepend `C:\Users\User\AppData\Roaming\fnm\node-versions\v22.23.2\installation` to PATH).
- Don't touch `src/motor/tick.ts`, `db.ts`, `events.ts`, or any Motor engine file. Pre-existing failures out of scope.
- Conventional commits with trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Event formatter (`palco-format`)

**Files:** Create `src/motor/palco-format.ts`; Test `src/__tests__/motor/palco-format.test.ts`.

**Produces:**
```ts
export function escapeHtml(s: string): string;           // & < > " '
export function usdFromMc(mc: number): string;           // 967000 -> "$9.67"
export function formatEventPt(type: string, payload: Record<string, unknown>): string; // safe HTML
```

Formatter strings (exact, matching `scripts/motor-dashboard.mjs`'s `feedLine` mapping): trade_opened `abriu {symbol} · notional {usd}`; trade_closed `fechou {symbol} · P&L {usd}` + ` · LIQUIDADO` when liquidated; trader_hired `🤝 <strong>{name}</strong> contratado(a) · slot {slot} · stake {usd}`; trader_fired `📦 <strong>{name}</strong> demitido(a) · devolveu {usd}<br><small>{reason}</small>`; trader_died `💀 <strong>{name}</strong> morreu · viveu {h}h · pico {usd}`; trader_promoted `🏆 <strong>{name}</strong> promovido(a) — {title}`; achievement `✨ <strong>{name}</strong> — "{label}"`; hr_review `🧾 RH: {reviewed} avaliados · {fired} demitidos · {promoted} promovidos · {held} mantidos · benchmark {benchmarkCents}c`; gen_started `🌱 Geração {genNumber} ({cohort}) começou — {seedNote}`; gen_ended `⚰️ Geração {genNumber} ({cohort}) acabou · pico {usd} · {daysLived} dias` + ` · 🔔 NOVO RECORDE` when isNewRecord; record_broken `🔔 RECORDE: {usd} ({cohort}, gen {genNumber}) — anterior {usd(previousRecordMc)}`; catch_up `⏪ catch-up de {bars} barras`; unknown type → `escapeHtml(type)`.

Tests (write first, watch fail, implement, pass): one per event type asserting the exact string; escaping test — `formatEventPt("trader_hired", { name: "<script>alert(1)</script>", slot: 1, stakeMc: 100 })` contains `&lt;script&gt;` and not `<script>`; `usdFromMc(-50)` → `"$-0.00"`? No — pin `usdFromMc(-5000)` → `"$-0.05"` and `usdFromMc(967000)` → `"$9.67"`. Pure module, runs under any Node: `npx vitest run src/__tests__/motor/palco-format.test.ts`.

Commit: `feat(motor): palco event formatter (safe PT strings)`.

---

### Task 2: Snapshot assembly (`palco-data`)

**Files:** Create `src/motor/palco-data.ts`; Test `src/__tests__/motor/palco-data.test.ts`.

**Consumes:** `formatEventPt`, `usdFromMc` (no — usd stays in format; data returns numbers) from Task 1; `better-sqlite3` types.

**Produces:** the `PalcoSnapshot` interface EXACTLY as spec §3, plus:
```ts
import type BetterSqlite3 from "better-sqlite3";
export function buildSnapshot(raw: BetterSqlite3.Database, nowMs: number): PalcoSnapshot;
```

Behavior (raw prepared SELECTs; MotorDb interface untouched):
- cards: equities from latest `equity_snapshots` row per cohort (default 1_000_000 when none); gens from unended `generations`; records = `max(MAX(peak_equity_mc) over ended, live peak ?? 0)` per cohort; gensN = COUNT per cohort; barsProcessed = COUNT(DISTINCT ts) FROM bars; lastBarTs = MAX(ts) FROM equity_snapshots (null when none); virginDays = lastBarTs && minStartedAt ? round(((lastBarTs - MIN(generations.started_at)) / 86_400_000) * 10) / 10 : 0.
- generations: every row ordered cohort, gen_number → `{ cohort, genNumber, peakEquityMc, barsLived, ended: ended_at !== null }`.
- equitySeries: per cohort, all `equity_snapshots` ordered by ts as `[ts, equityMc]`, downsampled by stride `ceil(n / 400)` (keep ≤ 400 points, ALWAYS include the last row).
- leaderboard: traders of unended generations, ordered evolved-first, live-first, book desc; genes = families joined `" + "`; achievements = labels of that trader's `achievement` events (payload_json `$.label`), chronological.
- feed: newest 40 events excluding `motor_started`/`motor_stopped`, each `{ id, ts, type, html: formatEventPt(type, payload) }`, newest first.
- `lastEventId` = MAX(events.id) ?? 0; `generatedAt` = nowMs. NO Date.now() in this module.

Tests (temp DB seeded via `openMotorDb` from `../../motor/db.js`, then pass `db.raw`): cards math incl. record = max(ended, live) with one ended gen (peak 1_480_000) + live gen (peak 1_200_000) → 1_480_000; virginDays 1-decimal; equitySeries ≤ 400 points and last point preserved for 1000 inserted snapshots; leaderboard ordering + achievements attached to the right trader; feed capped at 40, html contains the formatted string, excludes motor_started. Run under Node 22.

Commit: `feat(motor): palco snapshot assembly over motor.db`.

---

### Task 3: React app (`packages/palco`)

**Files:** Create the whole package — `packages/palco/{package.json, tsconfig.json, vite.config.ts, index.html, src/main.tsx, src/App.tsx, src/theme.css, src/types.ts, src/useSnapshot.ts, src/format.ts, src/tabs/PregaoTab.tsx, src/tabs/GeracoesTab.tsx, src/tabs/LeaderboardTab.tsx, src/tabs/MuralTab.tsx, src/__tests__/*.test.tsx}`.

**Consumes:** `PalcoSnapshot` shape (MIRRORED into `src/types.ts` — cross-package TS import is not wired; add a header comment "mirror of src/motor/palco-data.ts — keep in sync").

Package setup: name `@conway/palco`, private, `"type": "module"`; deps react ^18, react-dom ^18, primereact ^10, primeicons ^7, chart.js ^4, react-chartjs-2 ^5; devDeps vite ^5, @vitejs/plugin-react ^4, typescript ^5, vitest ^2, jsdom, @testing-library/react ^16, @testing-library/jest-dom ^6, @types/react, @types/react-dom; scripts `dev: vite`, `build: tsc -b && vite build`, `test: vitest run`, `clean: rimraf? no — "node -e \"fs.rmSync('dist',{recursive:true,force:true})\""` (match packages/cli's clean pattern — READ packages/cli/package.json first and mirror its conventions). vite.config.ts: react plugin + `server.proxy = { "/api": "http://localhost:4242", "/events": "http://localhost:4242" }`. Confirm `pnpm-workspace.yaml` already globs `packages/*` (read it; if not, add).

App structure:
- `main.tsx`: imports `primereact/resources/themes/lara-light-green/theme.css`, `primereact/resources/primereact.min.css`, `primeicons/primeicons.css`, then `./theme.css` (Harvey overrides LAST), renders `<App/>`.
- `theme.css`: Harvey tokens (Global Constraints) overriding PrimeReact variables — `--primary-color:#1e3d2f`, surfaces to ivory, `body{background:var(--ivory);color:var(--ink);font-family:Georgia,'Times New Roman',serif}`, `.label` small-caps Verdana utility, serif `h1` 400-weight green, hairline `.p-tabview` / `.p-datatable` borders (`#d8d4c8`), muted italic subtitles.
- `useSnapshot.ts`: `export function useSnapshot(): { snapshot: PalcoSnapshot | null; connected: boolean }` — on mount fetch `/api/snapshot` (initial), open `new EventSource("/events")`; `onmessage` → `setSnapshot(JSON.parse(e.data))`, `onopen` → connected true, `onerror` → connected false (EventSource auto-reconnects); cleanup closes.
- `App.tsx`: masthead (kicker `AUTOMATON · PESQUISA DE TRADING · DINHEIRO DE PAPEL`, H1 `A Firma`, italic sub `Gerações de $10 operando ao vivo na Binance — contra um controle aleatório e contra não fazer nada.`, live dot: green pulsing ● `ao vivo` when connected, gray `reconectando…` otherwise); hero cards row (equity firma / controle / `$10.00` parado / recorde / gerações `E/R` / `X de 90 dias` virgin counter); `<TabView>` with the four tabs; honesty footer verbatim: `Dinheiro real só entra em discussão se a linhagem evoluída vencer o controle aleatório E o não-fazer-nada por ≥ 3 meses de dados virgens ao vivo, fora da banda de ruído.`
- `format.ts`: `usd(mc)`, `dateShort(ts)` client helpers.
- `PregaoTab`: Chart.js line of `equitySeries` (firma `#1e3d2f` solid, controle `#8a8a7d` dashed, horizontal $10 annotation via a third flat dataset), plus a small "últimos trades" list from feed items whose type is trade_opened/trade_closed.
- `GeracoesTab`: Chart.js grouped bar — x = genNumber, series firma/controle peaks in dollars, `$10` dashed baseline dataset; below, a PrimeReact DataTable of `generations` (cohort Tag, gen, pico, barras, `em curso`/`encerrada`).
- `LeaderboardTab`: DataTable ranked (index+1), nome, time (`Tag` severity success for firma / secondary for controle), gen, status (vivo/morto/demitido with 💀/📦), book, P&L, trades, mesa `SYMBOL · 2x`, genoma (muted small), conquistas (✨ per achievement, `title` tooltip = label).
- `MuralTab`: list of feed items — `dangerouslySetInnerHTML` is ACCEPTABLE here ONLY because `html` is produced by our own escaping formatter server-side (comment this); `.ts` timestamp chip; newest first; items not in the previous snapshot get a `fade-highlight` CSS animation class (track prev ids in a ref).

Tests (jsdom, in-package `vitest run`): fixture `PalcoSnapshot` object; `useSnapshot` — mock global fetch + a stub EventSource class, assert snapshot lands and connected toggles; `LeaderboardTab` renders trader names and badges from fixture; `MuralTab` renders feed html (assert text from a formatted string appears); `App` shows masthead + all four tab headers.

Verification: `pnpm install` at root (workspace link), `pnpm --filter @conway/palco test`, `pnpm --filter @conway/palco build` (tsc + vite green). Root `npx tsc --noEmit` must stay clean (package has its own tsconfig; ensure root tsconfig doesn't sweep `packages/palco/src` — mirror how packages/cli is excluded).

Commit: `feat(palco): React/PrimeReact live front with Harvey theme and tabs`.

---

### Task 4: SSE server + wiring

**Files:** Create `scripts/palco-server.mjs`; Test `src/__tests__/motor/palco-server.test.ts`; Modify root `package.json` (scripts), `README.md` (section).

**Consumes:** `buildSnapshot` from `dist/motor/palco-data.js` (the server imports the COMPILED output like other scripts import dist — check how existing scripts import src code; if none do, import via `../dist/motor/palco-data.js` after `pnpm build`).

Behavior:
- Args: `--db <path>` (default `~/.automaton/motor.db`), `--port <n>` (default 4242), `--dist <path>` (default `packages/palco/dist`). Proper arg loop (the lineage-server bug is a known precedent — consume values).
- Opens better-sqlite3 `{ readonly: true, fileMustExist: true }`.
- `GET /api/snapshot` → `buildSnapshot(db, Date.now())` JSON, `cache-control: no-store`.
- `GET /events` → SSE headers; send one full snapshot immediately; `setInterval` 5s: if `MAX(events.id)` changed, send fresh snapshot; heartbeat comment `:hb` every 30s; clean up timers on close.
- Static: serve files under dist with content types (html, js, css, svg, ico, woff2, map); unknown path → index.html (SPA); missing dist → 503 text "rode pnpm palco:build".
- Root scripts: `"palco": "node scripts/palco-server.mjs"`, `"palco:build": "pnpm --filter @conway/palco build"`, `"palco:dev": "pnpm --filter @conway/palco dev"`.
- README (inside the Trading Firm section, after the Motor block): 4-line "Palco" block — `pnpm palco:build` once, `pnpm motor` + `pnpm palco` side by side, open `http://localhost:4242`; dev mode `pnpm palco:dev`.

Integration test (Node 22): create temp motor.db via `openMotorDb`, insert one generation + one event via the db module, spawn the server on an ephemeral port with `--db` (child_process, or import a `startPalcoServer` export — PREFER exporting `startPalcoServer({dbPath, port, distDir}): { close }` from the .mjs and importing it in the test); assert `/api/snapshot` returns JSON with `cards`; assert `/events` yields a `data:` line whose JSON parses (read a chunk, then abort); close cleanly.

Verification: full `npx vitest run src/__tests__/motor` green under Node 22; `pnpm build` green.

Commit: `feat(palco): SSE snapshot server and npm wiring`.

---

## Final gate (controller)

Whole-feature review (one dispatch): XSS surface (`dangerouslySetInnerHTML` fed ONLY by escaped formatter output), SSE resource leaks (timers cleared on client close), read-only DB guarantee, chart correctness (mc→$ conversions), theme fidelity to the Harvey tokens, README accuracy. Then run Motor + Palco together against the live DB and eyeball the page.
