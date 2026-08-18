# Palco v1.1 — Front Evolution Plan (dark site redesign)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. User-approved design (2026-08-17, pre-sleep autonomy granted): charcoal + green accent, site-like navigation, social Mural WITH cosmetic seeded reactions, new Empresa tab (org chart + lineage), clearer Gerações, friendly genome chips.

**Goal:** Evolve the Palco from the ivory TabView v1 into a dark, site-feeling product: top navigation, social-network Mural, corporate-structure tab, legible generations timeline and genome chips.

**Spec base:** `docs/superpowers/specs/2026-08-17-palco-live-front-design.md` (v1) + the user feedback below. This plan is the v1.1 delta spec.

**User feedback (verbatim):** "Trabalhar mais com preto e ir para algo mais com cara de site mesmo. Quanto as abas eu gostei, talvez a parte de geracao esteja confusa, e esse mural tem que ser algo mais como um linkedin ou um rede social sabe? mais descontratido algo como um lucro destaque, ou uma demissao. esse genoma tá um pouco estranho e seria bom ver a estrutura corporativa tbm."

## Global Constraints

Same as v1 plan (`2026-08-17-palco-live-front.md`): read-only DB, escapeHtml at format boundary, no external assets, ESM `.js` specifiers in src/, tests under `src/__tests__/motor/`, Node 22 for better-sqlite3 runs (fnm path), conventional commits + Opus trailer. Determinism: reactions/avatars seeded from event/trader ids — `mulberry32`-style, NEVER `Math.random`.

**v1.1 palette (replaces ivory tokens):** `--bg:#141412 --bg-raised:#1c1c19 --ink:#ecebe4 --ink-muted:#8f8d82 --rule:#2c2b27 --green:#58a27a --green-deep:#2e5c46 --red:#c46a5a`. Serif (Georgia) display stays; Verdana small-caps labels stay; hairline rules stay. Charts recolored for dark (firma `--green`, controle `#6f6d64` dashed, baseline `#4a4943`).

---

### Task A: Data layer extensions (`src/motor/palco-data.ts` + tests)

Extend `PalcoSnapshot` (and bump both copies — the mirror in `packages/palco/src/types.ts` is Task B's job):

1. Leaderboard items gain `genome: { symbol: string; leverage: number; riskFraction: number; combinator: string; genes: Array<{ family: string; params: Record<string, number> }> }` (raw parsed genome, params without the `family` key). Keep the existing `genes`/`combinator` string fields (back-compat).
2. Feed items gain `payload: Record<string, unknown>` (the parsed payload_json) alongside `html` — the social Mural builds post headlines/bodies from structured data with React's own escaping; `html` stays as fallback.
3. New `org` section:
```ts
org: {
  hrPolicy: string;   // fixed PT string, see below
  employees: Array<{ traderId: string; name: string; cohort: string; slot: number;
    status: string; bookMc: number; symbol: string; leverage: number;
    bornAt: number; diedAt: number | null;
    parentTraderId: string | null; parentName: string | null;  // from that trader's trader_hired event
    seedNote: string;  // generation seedNote (elite-clone/mutant/immigrant/fresh info)
  }>;
  history: Array<{ id: number; ts: number; type: string; html: string; payload: Record<string, unknown> }>;
    // ALL trader_hired / trader_fired / trader_promoted / gen_started / gen_ended events
    // of the CURRENT generations (both cohorts), chronological
}
```
`hrPolicy` exact string: `"RH baseado em evidência: compara cada trader ao benchmark max(controle aleatório, não fazer nada) na mesma janela de 7 dias. Demite só com evidência clara de underperformance; evidência insuficiente nunca demite nem promove."`
`parentName`: resolve parentTraderId → traders.name (null-safe; the parent may be from the same generation only — lookup across all traders is fine).
`seedNote` per employee: from the trader's own `trader_hired` event payload if it distinguishes, else the generation's seedNote — implementer judgment, must be deterministic and documented in the ledger.

Tests (extend `palco-data.test.ts`): genome struct present with parsed params; feed payload round-trips; org.employees carries parent link (seed a gen, insert a trader_hired event with parentTraderId, assert parentName resolved); org.history includes hires + fires of current gens in ts order and excludes older generations' events.

Commit: `feat(motor): palco snapshot v1.1 — structured genomes, feed payloads, org section`.

### Task B: React redesign (`packages/palco`)

1. **Theme swap** (`theme.css` rewrite): v1.1 palette above; keep serif/small-caps identity; PrimeReact widgets restyled dark (DataTable rows on `--bg-raised`, hairline `--rule` borders); switch the PrimeReact base theme import to `lara-dark-green` and override on top.
2. **Site shell** (`App.tsx`): replace TabView with a sticky top nav — left: serif wordmark `A Firma` + small-caps kicker; center/right: nav links `Pregão · Empresa · Gerações · Mural` (useState route, active = green underline) + live dot. Hero cards move into a slim strip under the nav (site header feel). Honesty footer stays at the bottom. Content in a centered `max-width: 1100px` container.
3. **Genome chips** (shared `GenomeChips.tsx`): friendly PT chips from `genome.genes` — momentum `⚡ Momentum {fast}/{slow}b`, meanReversion `🎯 Reversão z>{entryZ} ({lookback}b)`, breakout `🚪 Breakout {channel}b`, regimeFilter `🛡️ Regime SMA{sma}`; combinator sentence: all → `entra quando todos concordam`, majority → `entra pela maioria`, any → `entra se qualquer um sinalizar`; plus `{symbol} · {leverage}x`. Used in Leaderboard + Empresa.
4. **Mural social** (`MuralTab.tsx` rewrite): posts from feed items using `payload`:
   - Avatar: initials circle, background hue seeded from name (deterministic hash → HSL, muted saturation).
   - Author line: name + cargo (`Trader · Mesa {symbol}` for trader events; `RH` for hr_review/fired; `A Firma` for gen/record events).
   - Headlines by type: trade_closed with pnl>0 → `📈 Lucro em destaque`; pnl<=0 small → grouped (below); trader_fired → `📦 Desligamento`; trader_hired → `🤝 Nova contratação`; trader_died → `🕯️ Nota de falecimento (do book)`; trader_promoted → `🏆 Promoção`; achievement → `✨ Conquista desbloqueada`; record_broken → `🔔 Recorde da firma`; gen_started/gen_ended → `🌱/⚰️ Comunicado da diretoria`; hr_review → `🧾 Ciclo de avaliação`.
   - Post body: casual PT one-liner built from payload (e.g. fired: `Hoje encerramos o ciclo de {name} na firma. Devolveu {usd} ao caixa. Desejamos sorte na próxima geração.` + the HR reason in a quoted small block).
   - **Trade grouping:** consecutive trade_opened/trade_closed with |pnl| < $0.05 collapse into one `🔁 Resumo da mesa` post per symbol per snapshot render (count + net) — big wins/losses stay as their own posts.
   - Relative time (`há 12 min` / `há 3 h` / `ontem`), computed client-side.
   - **Reactions:** 👏 🔥 😢 with counts seeded from event id (`mulberry32(id)`-style inline PRNG, ranges 0–40; 😢 only on fired/died posts), non-interactive, with a muted footnote once at the list top: `reações são decorativas — ninguém está de fato aplaudindo (ainda)`.
   - New-item fade-highlight stays.
5. **Empresa tab (new, `EmpresaTab.tsx`)**: three blocks —
   - `RH` card at top: title `Recursos Humanos`, the `org.hrPolicy` text, counters (demissões/promoções do ciclo, from org.history).
   - Org chart: two columns (A Firma / Controle) of employee cards (avatar, name, cargo Mesa·lev, book, status chip vivo/morto/demitido, GenomeChips mini); lineage line under each hired-by-mutation employee: `↳ mutação de {parentName}` (from parentTraderId), immigrants `↳ contratação externa (genoma novo)`, clones `↳ continuação de {parentName}`.
   - `Histórico` timeline: org.history rendered as compact rows (icon + html + relative time).
6. **Gerações clarified** (`GeracoesTab.tsx` rework): keep the bar chart on top but retitle + PT explainer line (`Cada barra é o pico que uma geração de $10 alcançou antes de morrer. Verde = firma; cinza = controle. Se a firma evolui de verdade, as barras verdes sobem com o tempo.`); below, replace the DataTable with a timeline of generation cards: `Geração {n} — {em curso|encerrada}`, dias vividos, pico (big serif number), finalEquity when ended, `🔔 recorde` badge, thin progress bar peak vs current record.
7. **Pregão**: recolor charts; trades list becomes compact rows w/ green/red pnl; otherwise unchanged.
8. Tests: update existing RTL tests for the new nav (4 links), MuralTab social rendering from a fixture with payload (post headline text asserted, reaction counts deterministic across two renders), EmpresaTab renders employees + lineage line, GenomeChips formats each family. `pnpm --filter @conway/palco test` + `build` green.

Commit: `feat(palco): v1.1 dark site redesign — social mural, empresa org chart, clearer generations`.

### Final gate (controller)

Rebuild (`pnpm palco:build`), restart server, verify /api/snapshot has the new fields and the page serves; one review dispatch (XSS: Mural now renders from payload via React text — confirm NO dangerouslySetInnerHTML remains except where fed by escaped html; determinism of reactions; type-mirror sync); fix; done.
