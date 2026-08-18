# Palco — Live Front for the Motor — Design Spec

**Date:** 2026-08-17
**Status:** Approved design, pending implementation plan
**Extends:** `docs/superpowers/specs/2026-08-17-motor-live-firm-design.md` (the
Motor's event log + DB is the only data source; the Palco never writes).

## 1. Purpose

Sub-project 2 of 3 (Motor → **Palco** → Torneio de RH). A realtime local front
for the live firm: hero cards, the per-generation record chart (the project's
headline metric), an LMArena-style trader leaderboard, and a LinkedIn-style
event feed — in the Harvey editorial identity the user chose (ivory ground,
deep forest green + charcoal ink, serif display, small-caps labels, hairline
rules, generous whitespace).

## 2. Architecture

**User directive (mid-design):** "faz com react/primereact e com abas" — the
front is a React + PrimeReact app organized in tabs, not a vanilla page.

```
~/.automaton/motor.db  (written by the Motor; Palco opens READ-ONLY)
  -> src/motor/palco-format.ts   formatEventPt(type, payload) -> safe HTML (pure, tested)
  -> src/motor/palco-data.ts     buildSnapshot(db, nowMs) -> PalcoSnapshot (pure reads, tested)
  -> scripts/palco-server.mjs    HTTP :4242 — serves packages/palco/dist statics,
                                 GET /api/snapshot (JSON), GET /events (SSE)
  -> packages/palco/             Vite + React 18 + TypeScript + PrimeReact app
       src/App.tsx               masthead + live dot + TabView (as abas)
       src/theme.css             Harvey identity over a PrimeReact light theme
       src/useSnapshot.ts        EventSource hook (auto-reconnect, /api fallback)
       src/tabs/*.tsx            one component per aba
```

- **SSE model (v1, deliberately simple):** the server polls `MAX(events.id)`
  every 5 s; when it changes (or on connect) it pushes the ENTIRE fresh
  `PalcoSnapshot` as one SSE `data:` message. Snapshots are small (10 roster
  rows, 40 feed items, ~400 chart points); full re-render beats incremental
  bookkeeping. Heartbeat comment every 30 s. React consumes it via a
  `useSnapshot()` hook.
- **Workspace package:** `packages/palco` joins the existing pnpm workspace
  (same pattern as `packages/cli`). `pnpm palco` = build (if stale) + serve;
  `pnpm palco:dev` = vite dev server proxying `/api` + `/events` to :4242.
- Charts via `chart.js` + `react-chartjs-2` (bundled locally, no CDN).
  PrimeReact `DataTable` powers the LMArena-style leaderboard, `TabView` the
  tabs, `Tag`/`Badge` the status chips.
- Node 22 required for the server (better-sqlite3) — same as the Motor.
- All assets bundled by Vite; no external requests at runtime, no writes, no
  secrets, no LLM.

## 3. PalcoSnapshot (the data contract)

```ts
export interface PalcoSnapshot {
  generatedAt: number;         // caller-provided nowMs (no Date.now in the module)
  lastEventId: number;
  cards: {
    evolvedEquityMc: number; randomEquityMc: number;
    evolvedGen: number; randomGen: number;
    recordEvolvedMc: number; recordRandomMc: number;   // max(ended peaks, live peak)
    gensEvolved: number; gensRandom: number;
    barsProcessed: number; lastBarTs: number | null;
    virginDays: number;        // (lastBarTs - min(generations.started_at)) / 86_400_000, 1 decimal
  };
  generations: Array<{ cohort: string; genNumber: number; peakEquityMc: number;
    barsLived: number; ended: boolean }>;              // records chart, both cohorts
  equitySeries: { evolved: [number, number][]; random: [number, number][] }; // [ts, mc], ~400 pts
  leaderboard: Array<{ name: string; cohort: string; genNumber: number;
    status: string; bookMc: number; realizedPnlMc: number; tradesCount: number;
    symbol: string; leverage: number; genes: string; combinator: string;
    achievements: string[] }>;                          // labels, from achievement events
  feed: Array<{ id: number; ts: number; type: string; html: string }>; // 40 newest, html pre-formatted+escaped
}
```

`buildSnapshot(db, nowMs)` reads only: `events`, `generations`, `traders`,
`equity_snapshots`, `bars`. Leaderboard = current (unended) generations'
traders, firm cohort first, live first, book desc. `feed[].html` comes from
`formatEventPt` — ALL user-influawait strings escaped there (names come from a
fixed list today, but escaping is non-negotiable at the format boundary).

## 4. The page (Harvey identity, full commitment)

Design tokens (committed light look; no dark variant in v1):
`--ivory:#f6f4ee --ink:#232320 --green:#1e3d2f --green-soft:#2e5c46
--rule:#d8d4c8 --muted:#7a7768`; Georgia serif display; Verdana 10px
letter-spaced small-caps labels; hairline rules; wide margins.

Layout: persistent **masthead** (small-caps kicker "Automaton · pesquisa de
trading · dinheiro de papel", serif H1 "A Firma", italic subtitle, live dot —
green pulse connected / gray "reconectando…") and **hero cards** row (equity
firma / controle aleatório / $10 parado / recorde / gerações vividas / "X de
90 dias" money-gate counter) always visible above the tabs; the pre-registered
**honesty footer** always visible below them.

As abas (PrimeReact `TabView`):
1. **Pregão** — curva de equity ao vivo (Chart.js line: firma verde, controle
   cinza tracejado, baseline $10) + posições abertas e últimos trades.
2. **Gerações** — THE longitudinal chart: grouped bars per generation (firm
   peak green vs random peak gray, $10 baseline), live generations annotated
   "em curso"; table of every generation with peak/duração/finalEquity.
3. **Leaderboard** — PrimeReact `DataTable`, LMArena-style: rank, nome, time
   (firma/controle `Tag`), gen, status, book, P&L, trades, mesa (symbol·lev),
   genoma, badges ✨ de conquistas (tooltip com o label).
4. **Mural** — the feed; new items prepend with a soft highlight fade;
   demissões mostram o motivo do RH; recordes ganham o 🔔.

React specifics: `useSnapshot()` hook owns the EventSource (auto-reconnect,
initial `/api/snapshot` fetch as fallback); components are pure functions of
`PalcoSnapshot`; PrimeReact light theme with `theme.css` overriding tokens to
the Harvey palette (ivory surfaces, forest-green primary, Georgia serif
display, Verdana small-caps labels, hairline borders).

## 5. Testing (TDD)

- `palco-format`: every event type → expected PT string; HTML escaping of
  payload strings (`<script>` in a name renders inert); unknown type falls back
  safely.
- `palco-data`: against a seeded temp motor.db — cards math (records = max of
  ended+live peaks), virginDays, equitySeries downsampling to ≤ 400 points,
  leaderboard ordering, feed limited to 40 with pre-formatted html,
  achievements attached to the right trader.
- `palco-server`: one integration test on an ephemeral port — GET
  /api/snapshot parses as a PalcoSnapshot; GET /events streams an SSE `data:`
  whose JSON parses too (then closes). Runs under Node 22 like the rest.
- React app: `vite build` + `tsc --noEmit` green is the gate; RTL smoke tests
  (jsdom) for `useSnapshot` state transitions and for the leaderboard/mural
  rendering a fixture snapshot. Visual QA is manual (localhost).

## 6. Out of scope (later)

Auth/remote serving (localhost only), dark mode, incremental SSE diffs,
Torneio de RH panels, historical drill-downs per trader.
