# Palco v3 — Sophistication Pass Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. User feedback (2026-08-18, verbatim): "mais uma revisao de frontend... deixar mais bonito e um pouco mais sofisticado. A tela um o grafico ta muito grande. leaderboards tem muito o que melhorar, pode tirar genoma ta muito abstrato e conquistas ta meio estranho. a parte de empresa pode ser um grafo eu acho. Geracao ta estranho tbm. Mural quero algo com cara orkut. pode adicionar um pouco de animacao usar um prime react ou outra lib mais moderna de componente pra agilizar."

**Goal:** One sophistication round over the pxpush identity: right-sized Pregão, a cleaner Leaderboard, Empresa as an interactive lineage GRAPH, a legible Gerações, and the Mural as an Orkut scrapbook pastiche — with tasteful animation now allowed.

**New deps (packages/palco):** `@xyflow/react` (node graph), `framer-motion` (micro-animations). PrimeReact stays for DataTable. chart.js stays.

**Identity:** global pxpush dark identity unchanged (tokens, grain, scanlines, Anton/Archivo/Geist Mono). The Mural gets a deliberate in-frame retro-light inset (see Task 5) — an "old page on the old screen" concept.

**Animation budget (user: "um pouco"):** micro only — feed/scrap slide-in, tab content fade (120-180ms), hero number count-up on change, leaderboard row layout animation, react-flow animated lineage edges, hover states. NO parallax, NO looping keyframes beyond the existing live-dot.

## Task 0: Data — open positions on the leaderboard (src/motor + mirror)

`src/motor/palco-data.ts`: leaderboard entries gain `inPosition: boolean; entryPriceCents: number | null` parsed from the trader row's `state_json` (fields `inPosition`, `entryPriceCents`; null when flat). Update `packages/palco/src/types.ts` mirror + test fixture + one palco-data test assertion. Everything else untouched.

## Task 1: Pregão right-sized

- Equity chart: `max-height: 320px` in a panel taking ~62% width on desktop (grid `1.6fr 1fr`), full-width stacked on mobile. `maintainAspectRatio: false`.
- Right column, two stacked panels:
  - **Posições abertas**: from leaderboard entries with `inPosition` — row per trader: name, mesa, entry price (mono), current price (from the last equitySeries? NO — closes aren't per-symbol in the snapshot; show entry only + book), green side tag "LONG". Empty state: "ninguém posicionado — a firma espera sinal."
  - **Últimos trades**: existing compact list, capped at 8 rows.
- Hero strip numbers animate on change (framer-motion `animate` on value change or a small count-up hook; 300ms).

## Task 2: Leaderboard cleaned

- REMOVE the genoma column and the conquistas column (user: abstract/weird).
- Columns: `#` rank (top-3 get a green chip 1/2/3), nome (avatar mini + name), time (chip firma/controle), gen, status (chip), book (mono, bold), P&L realizado (mono, green/red), P&L % (realized/2_000_000 start, one decimal), trades, mesa (`BTC · 2x` mono).
- Achievements shrink to a subtle mono badge next to the name: `✨3` with `title` tooltip listing labels; zero when none (hidden).
- Row hover: raised bg + hairline left accent. Rank reorder animates via framer-motion `layout` on the row list (PrimeReact DataTable does not support that directly — acceptable fallback: keep DataTable, animate only a custom top-3 podium strip above it; implementer picks the cheaper one that looks good and documents the choice).

## Task 3: Empresa as a lineage graph

- Replace the two-column card grid with **@xyflow/react**: 
  - Nodes: `RH` node top-center (policy tooltip); firm traders left cluster; control traders right cluster. Custom node = compact employee card (avatar, name, book mono, status chip). Dead/fired nodes at 55% opacity.
  - Edges: RH → every firm trader (hairline, faint); lineage `parentTraderId` → child as **animated dashed green edge** labeled "mutação"; generation-seed nodes get a faint edge from an invisible "Gen N" anchor OR no edge (implementer judgment, keep it uncluttered).
  - Pan/zoom enabled, `fitView` on mount, background dots off (keep our grain), controls minimal.
- Keep the RH counters strip above the graph and the Histórico timeline below (unchanged).
- Graph must render from the fixture in a jsdom test (mock ResizeObserver — xyflow needs it; standard 3-line stub).

## Task 4: Gerações legible

- Drop the mixed bar+line chart (and its `as unknown as` cast). New layout:
  - Top: **"Geração atual"** summary panel — big Anton numbers: dias vivos, pico, equity agora, vs. recorde (with a thin progress bar to record).
  - Below: **one horizontal "vida" bar per generation**, newest first: bar length ∝ days lived (relative to the longest), bar label `Geração N — pico $X — Y dias`, firm green / control grey pairs side by side, `🔔` on records, `em curso` pulse chip on live gens. Pure divs + CSS, no chart lib. Framer-motion: bars grow-in on mount (staggered 40ms).
  - Keep the explainer line, reworded shorter: "Cada geração começa com $100. A barra mostra quanto tempo viveu; o número, o pico que alcançou. Se a seleção funciona, os picos verdes sobem."

## Task 5: Mural Orkut

The centerpiece. Inside the dark page, the Mural becomes a light retro inset — an old social page glowing on the CRT:
- Container: max-width 860px centered panel with rounded 8px corners, pastel Orkut palette INSIDE it only: header bar lavanda `#a8b8d8`, body `#e8eef7`, boxes white, links `#315c99` underlined, small sans (Verdana 11-12px) — the classic. A subtle stronger scanline overlay on this panel sells the "tela antiga".
- Header: `scraps (N)` tab-style title (rounded top tabs, active white), fake breadcrumb `perfil · scraps · depoimentos` (decorative links).
- Each **scrap**: classic two-cell layout — avatar 48px square left (white border, shadow), right box: author name as blue link + cargo small grey, body text dark `#333` on white box with rounded corners, timestamp bottom-right tiny grey ("em 18/08/2026 14:32" absolute format — Orkut style), separator dotted.
- Post-type headlines keep the emojis but restyled as small bold dark text. Reactions become Orkut-ish footer links: `👏 12 pessoas aplaudiram · 🔥 3 · responder` (decorative, underlined blue). Disclaimer becomes a tiny grey footer inside the panel.
- New scrap: framer-motion slide-down + brief yellow highlight fade (the old "new scrap" feel).
- Trade grouping stays. All content still React-text from payload (XSS posture unchanged; the `html` fallback branch keeps its server-escaped-only rule).

## Verification & gates

Per task: in-package tests updated (content assertions never weakened; new: graph renders fixture nodes, scraps render author + body, positions panel from inPosition fixture), `pnpm --filter @conway/palco test` + `build` green, root `tsc --noEmit` clean (Task 0 also `npx vitest run src/__tests__/motor`). Final: rebuild, verify served page + snapshot, one light review pass (XSS posture, deps bundled — no CDN, determinism untouched), controller fixes, done.

Commits: one per task (0..5), conventional, Opus trailer.

## Addendum: fun pass (user, mid-plan: "talvez deixar um pouco mais divertido tbm no que der")

Cross-cutting, deterministic, cheap — sprinkle where it fits:
- **Humores**: mood emoji next to trader names (leaderboard + graph nodes): 😎 book >= 105% do stake, 🙂 normal, 😬 95-100%, 😰 < 95%, 💀 morto, 📦 demitido.
- **Mural Orkut garnish**: fake visitor counter in the panel footer ("você é o visitante nº N" — N derived from lastEventId, zero-padded), and a decorative "comunidades" box with 3 trading-joke communities e.g. "Eu amo taxa de funding (12 membros)", "Perdi tudo no 3x alavancado (5.021 membros)", "RH me demitiu por evidência (1 membro)".
- **Empty states com voz**: "ninguém posicionado — a firma espera sinal", "nenhuma demissão ainda — o RH observa em silêncio".
- Never fake DATA (numbers about money/records stay real); fun is copy + decoration only.
