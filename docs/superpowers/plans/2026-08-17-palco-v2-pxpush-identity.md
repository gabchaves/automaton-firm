# Palco v2 — pxpush Identity Swap Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. User-approved (2026-08-17): "usa a identidade visual desse site aqui: https://pxpush.com/about — se inspire muito nele... identidade visual completa e bem fiel, com a aba de mural com cara de rede social velha. N precisa de tanta animacao."

**Goal:** Reskin the Palco (structure/tabs/data untouched) onto the pxpush.com identity — dark brutalist studio look — with the Mural restyled as an early-2000s social network (Orkut/old-Facebook boxes).

**Scope:** `packages/palco` only (theme.css, App shell, tabs, small new deps). No data-layer changes. Tests keep passing (they assert content, not styling; adjust only selectors/classNames if a test greps one).

## Identity tokens (extracted from pxpush.com's live CSS — use EXACTLY)

```css
:root {
  --bg: #1a1a1a;            /* page ground */
  --ink: #bababa;           /* primary text (their --grey/--primarycolor) */
  --black: #111;            /* raised/inset panels */
  --red: #ff001a;           /* losses, deaths, fired */
  --blue: #03049c;          /* chip text, links-on-grey, section tint */
  --lightblue: #9fe4f3;     /* links on dark */
  --cream: #bab5a6;         /* section tint / warm panel */
  --green: #0f0;            /* terminal green: profits, live dot, firm chart */
  --pink: #a7849d;          /* rare tint */
  --lightgrey: #71737d;     /* muted text */
  --border: 1px solid hsla(0, 0%, 100%, .7);
  --border-fade: 1px solid hsla(0, 0%, 100%, .5);
  --radius: .5vw;
}
```

**Typography (bundled via npm @fontsource packages — NO runtime external requests):**
- Display: `@fontsource/anton` → `Anton, Impact, sans-serif` — their SemiSqueezed substitute. Headlines HUGE, uppercase, `line-height: .9`, tight; h1 `clamp(40px, 6vw, 96px)`.
- Body: `@fontsource/archivo` (400/500) → `Archivo, Helvetica, Arial, sans-serif` — Graphik substitute.
- Mono/labels: `@fontsource/geist-mono` → `"Geist Mono", Consolas, monospace` — nav links, timestamps, numbers, small-caps labels.

**Signature patterns to reproduce faithfully:**
1. **Chip label**: `background: var(--ink); color: var(--blue); padding: 0 .6em;` inline-block, mono or body font, no radius or tiny. Used for section labels, statuses, counters.
2. **Grain overlay**: fixed full-viewport `::after` on the app wrapper, subtle noise via inline SVG feTurbulence data-URI, `mix-blend-mode: overlay; opacity: .25; pointer-events: none;` STATIC (user: less animation).
3. **Hairline white borders** everywhere panels meet: `var(--border)` / `var(--border-fade)`.
4. **Colored section tints**: hero cards strip may sit on `--black`; one accent section (e.g., the honesty footer) on `--blue` with `--ink` text; use tints sparingly.
5. **Huge condensed headlines**: `A FIRMA` in Anton uppercase; tab titles same family smaller.
6. Numbers/timestamps in Geist Mono.

## Task 1: Identity foundation (`theme.css` + shell)

- Add deps: `@fontsource/anton`, `@fontsource/archivo`, `@fontsource/geist-mono`; import in `main.tsx` BEFORE theme.css. DROP the PrimeReact lara theme import? NO — keep `lara-dark-green` as widget base but override aggressively (DataTable etc. still need structure).
- Rewrite `theme.css` to the token sheet above: body bg/ink/Archivo; Anton headline classes; `.label` → the chip pattern (grey bg, blue text); nav links Geist Mono uppercase letter-spaced, active = green underline 2px; live dot `--green` (subtle pulse ok); hero cards → boxy `--black` panels with hairline borders, values in Geist Mono, big; honesty footer → `--blue` background band, `--ink` text, mono.
- Grain overlay on the wrapper (static SVG noise data-URI).
- Charts recolor (shared chart option constants live in the tabs; adjust there in Task 2 if not central): firm `--green`, control `#71737d` dashed, baseline `hsla(0,0%,100%,.35)` dashed, red markers stay `--red`.
- Buttons/inputs (if any) boxy: transparent bg, hairline border, hover invert (bg `--ink`, text `--bg`) — pxpush button behavior.

Commit: `feat(palco): pxpush identity foundation — palette, type, grain, chips`.

## Task 2: Components pass + Mural rede-social-velha

- **Mural** (the centerpiece): each post becomes an old-social-network box —
  - Outer: `--black` panel, hairline border, tiny radius.
  - **Title bar** (the retro signature): full-width strip `background: var(--ink); color: var(--blue);` containing a SQUARE 28px avatar (initials, hue kept from v1.1 but muted), author name in bold, cargo, and right-aligned mono timestamp (`há 12 min`).
  - Body: post text in Archivo on `--black`.
  - **Footer bar**: separated by hairline — reactions as old-style counters in mono (`👏 12 · 🔥 3 · 😢 1`) plus decorative underlined `--lightblue` pseudo-links `curtir · comentar` (non-interactive, cursor default; they are set dressing). Keep the existing disclaimer line, restyled as a chip.
  - Headline emojis/types stay from v1.1; big-pnl posts get a `--green`/`--red` left border 3px.
  - Optional retro garnish (cheap, tasteful): a mono "scrap #N" counter using the event id, top-right of the title bar.
- **Leaderboard**: DataTable restyled boxy — header row as a grey/blue chip strip, hairline row separators, rank + numbers in Geist Mono, status vivo = green chip / morto = red chip / demitido = lightgrey chip (chip pattern), genome chips become mono outlined tags (transparent bg, hairline border).
- **Empresa**: employee cards → same retro panel + title-bar treatment as Mural posts (avatar square in the strip); RH card gets a `--cream` tinted variant with `--black` text; lineage lines in mono with `↳`.
- **Gerações**: generation timeline cards → boxy panels, peak number HUGE in Anton, `em curso` as green chip / `encerrada` grey chip; explainer line kept, mono.
- **Pregão**: chart recolors per Task 1 spec; trades list rows mono with green/red pnl.
- Tests: run in-package suite; where a test asserts a removed className, update the selector — NEVER weaken content assertions. `pnpm --filter @conway/palco test` + `build` green; root `npx tsc --noEmit` clean.

Commit: `feat(palco): pxpush component pass — retro social mural, boxy tables and cards`.

## Final gate (controller)

Rebuild, restart server, verify page + snapshot; quick review dispatch (fidelity to token sheet, no external requests introduced by fonts — verify @fontsource imports are bundled, no CDN URLs in dist; content assertions intact); fix; done.
