# Trading Research — Measured Findings

An autonomous multi-agent trading firm built on the Automaton runtime, and what
it actually measured. Six experiments, six honest results. **No profitable edge
was found in public market data.** This document records what was tested, what
the numbers were, and why each null result is trustworthy.

The value here is not a strategy. It is a research platform that refuses to
fool itself, and the measurements it produced.

---

## The system

| Layer | What it does |
|---|---|
| **CEO** (`carry-strategist.ts`, `strategist.ts`) | LLM writes the next generation's strategy — free-form markdown, or structured `CarryParams` JSON with a rationale |
| **HR** (`firm.ts`, `hr-evaluation.ts`) | Selection: death at $0, senior backfill, intern hiring, and evidence-based promotion against a benchmark |
| **Traders** (`carry-firm.ts`, `directional-engine.ts`) | Each holds its own book and P&L; dies at zero |
| **Evaluation** (`compare-generations.ts`, `walk-forward.ts`, `resilience-lab.ts`, `era-evolution.ts`) | Out-of-sample gates, walk-forward across regimes, Monte Carlo control cohorts |

### The honesty guards (why the nulls are trustworthy)

These exist because every one of them caught a real self-deception during
development:

- **Out-of-sample evaluation** — a candidate strategy is judged only on a
  window disjoint from the one it was trained on.
- **Small-sample gate** (`compare-generations.ts`) — if either side has fewer
  than N closed trades, the verdict is forced to a tie. One lucky trade cannot
  crown a winner.
- **Fees are engine constants, never tunable** — 10 bps spot + 5 bps perp taker
  per leg. A strategy cannot wish its costs away.
- **Position size is fixed, not evolvable** — net funding scales linearly with
  size, so a tunable size would let evolution "win" by leverage instead of
  timing.
- **Control cohorts** — a random-decider cohort and a never-selected fresh
  population, run on identical data with identical parameters. This is what
  separates a discovery from a story.
- **Pre-registered decision rules** — the threshold for "skill demonstrated"
  was written down before any result existed, along with an explicit
  45–55% noise band that must be reported as luck.
- **Failures are reported, never dropped** — delisted symbols, thin windows and
  extinction events appear in the output with their reason.

---

## Experiment 1 — CEO-evolved directional TA

**Question:** can an LLM CEO, reading trader journals and performance, write
technical-analysis strategies that beat a baseline out-of-sample?

**Setup:** BTCUSDT 4h candles, disjoint train/eval windows, 4 generations, real
inference (Gemini 3 Flash via fal). Incumbent and candidate both backtested on
the same unseen window.

**Result:**

| Generation | Out-of-sample PnL | Adopted |
|---|---|---|
| 1 | $0.00 (0 trades) | no |
| 2 | $0.00 (0 trades) | no |
| 3 | −$0.02 | no |
| 4 | −$0.14 | no |

A live firm round over the same period realized **−$0.02**.

**Finding:** no generation beat the base. The CEO's *reasoning* was sound — it
correctly argued about costs and regime — but public TA on liquid BTC contains
no persistent signal to reason about.

---

## Experiment 2 — Funding carry, walk-forward across regimes

**Question:** does delta-neutral funding carry (long spot + short perp,
collecting funding) survive regimes it was not designed for?

**Setup:** BTCUSDT, 5 historical windows, 3 senior archetypes with own books,
basis P&L and taker fees modeled, $3,000 total capital.

**Result:**

| Window | PnL | Worst drawdown |
|---|---|---|
| 2021-bull | **+$305.41** | $2.33 |
| 2022-bear | −$30.91 | $33.24 |
| 2023 | +$19.26 | $2.30 |
| 2024 | +$83.68 | $1.65 |
| recent-6m | +$20.28 | $9.18 |

**80% of windows profitable, +$397.72 total.**

**Finding:** the carry works, and the single loss lands exactly where theory
predicts — a bear market, where funding turns negative and the position pays
instead of collecting. A loss in the right place is evidence the model is
honest, not broken.

---

## Experiment 3 — Symbol sweep (does it pay better elsewhere?)

**Question:** BTC perp is the most crowded market. Do higher-funding altcoins
pay meaningfully more?

**Setup:** 6 symbols × 4 regimes, same machinery. `LUNAUSDT` and `AVAXUSDT`
included deliberately as a survivorship-bias control.

**Raw ranking (annualized on $3,000):**

| Symbol | Annualized | Profitable windows |
|---|---|---|
| LUNAUSDT | 19.8% ⚠️ | 1/2 |
| ETHUSDT | 7.9% | 2/4 |
| BTCUSDT | 6.7% | 2/4 |
| DOGEUSDT | 6.7% | 2/4 |
| SOLUSDT | 6.0% | 2/4 |
| AVAXUSDT | 5.4% | 2/4 |

⚠️ **LUNA topped the ranking because it stopped existing.** It collapsed in May
2022 and was delisted, so 2 of its 4 windows have zero data. It "won" by
ceasing to exist — precisely the artifact the control was included to expose.

**Excluding the 2021 bull:**

| Symbol | Annualized |
|---|---|
| BTCUSDT | 1.0% |
| ETHUSDT | 0.5% |
| SOLUSDT | 0.3% |
| DOGEUSDT | −0.5% |
| AVAXUSDT | −0.5% |

**Per-window totals across all symbols:** 2021-bull **+$2,069**, 2024 +$439,
2022-bear **−$266**, recent-6m **−$172**.

**Finding — two of them:**

1. **Altcoins do not pay better.** Higher funding is offset by more volatile
   basis and the same fees. The hypothesis was tested and refuted.
2. **Funding carry is a bull-market bet wearing a market-neutral costume.**
   Funding is positive when the crowd is levered long. Strip the 2021 bull and
   the entire edge collapses to ~0–1% annualized — below the risk-free rate,
   before counting exchange risk.

---

## Experiment 4 — The firm as a roster

**Question:** with per-employee books and the death/hire dynamics, who earns
what?

**Setup:** 2021 high-funding window, 3 senior archetypes at $1,000 each,
interns hired at $10 profit with a $2 stake.

| Role | Archetype | Book | Realized PnL |
|---|---|---|---|
| senior | moderado | $1,101.58 | **+$103.58** |
| senior | agressivo | $1,101.44 | **+$103.44** |
| senior | conservador | $1,096.35 | +$98.35 |
| intern ×3 | (inherited) | $2.00 | $0.00 |

**Total realized: +$305.37.** Each senior crossed the $10 threshold and hired
an intern.

**Finding:** the firm mechanics work end to end. But interns earned exactly
nothing — a $2 stake produces a $1 notional, and funding on that rounds to zero
cents. Below roughly $100 of book, the carry is arithmetically invisible: fixed
costs do not scale down.

---

## Experiment 5 — Resilience lab: skill or luck?

**Question:** under high risk, does a signal-driven decider beat a coin flip?

**Setup:** 500 Monte Carlo trials on SOLUSDT history, paired — both cohorts run
on the *identical* sampled window with identical leverage, fees and capital.
Only the decision function differs. Decision rule pre-registered: skill requires
≥200 trials, ≥60% paired win rate, and a lower ruin rate.

| Cohort | Ruin | Above start | Median final |
|---|---|---|---|
| Signal-driven | 0.0% | 39.2% | 281c |
| Random | 0.5% | 27.1% | 228c |

**Paired win rate: 75.4%** — the pre-registered rule is met.

**Then the decisive follow-up — rerun with fees disabled:**

| | Paired win | Signal | Random |
|---|---|---|---|
| With fees (10 bps) | **75.4%** | 281c | 228c |
| Without fees | **58.8%** | 293c | 288c |

**Finding:** removing fees collapses the advantage from 53c to 5c and drops the
paired win rate *below* the skill threshold. **~90% of the measured "skill" was
cost discipline, not prediction** — the signal cohort wins because it trades
less, not because it forecasts better.

And the number that settles it: **doing nothing = 300c.** Both cohorts finish
below that in both scenarios. Beating a bad benchmark is not an edge.

**Method lesson:** pre-registration protects against rationalizing a result. It
does not protect against measuring against the wrong comparison. The benchmark
must be `max(random, doing nothing)`.

---

## Experiment 6 — Chained era evolution

**Question:** if a population is selected era by era, do survivors of the past
predict the future?

**Setup:** SOLUSDT split by calendar year. Population of 60 selected on
2021→2025 (survivors carry forward and mutate); 2026 judges them against a
**fresh, never-selected population** on identical data. Selection uses the
evidence-based HR (benchmark-relative, never fires the unevaluable). Variation
is seeded mutation — no LLM.

| Era | Population → survivors | Median net |
|---|---|---|
| 2021 | 60 → 60 | +$155.52 |
| 2022 | 60 → **1** | −$2.47 |
| 2023 | 60 → 47 | +$0.79 |
| 2024 | 60 → 37 | −$0.26 |
| 2025 | extinction → repopulated | — |

**Final era (2026): survivors −164c vs fresh −143c.**

**Finding:** survivors of five selection eras performed *worse* than a
population that was never selected at all. **Selection produced no predictive
advantage.** The 2022 collapse (60 → 1) shows the mechanism: selection was
capturing regime fit, not skill, and regimes change.

The deeper result: the HR was working correctly — rigorous, benchmark-relative,
evidence-gated — and still produced nothing, because **a perfect selector over
an empty space finds nothing.** Selection quality was never the bottleneck.

---

## Conclusions

1. **No edge exists in public price data.** Directional TA, funding carry (BTC
   and alts), and evolved signal rules were each tested out-of-sample and each
   failed. Where returns appeared, they were regime artifacts (the 2021 bull),
   survivorship artifacts (LUNA), or cost artifacts (fee discipline mistaken
   for prediction).
2. **Funding carry is real but not investable at retail scale** — roughly 0–1%
   annualized outside a bull market, below the risk-free rate before exchange
   and execution risk.
3. **Small capital cannot produce income.** Fixed costs (minimum order size,
   withdrawal fees, integer-cent rounding) do not scale down. At $10 the carry
   collects nothing and still pays fees.
4. **The control cohort is the most valuable component built here.** Twice it
   converted an apparent success into a correct null: LUNA's ranking, and the
   "75.4% skill" that was fee discipline. Without controls, both would have
   read as progress.
5. **Selection cannot manufacture an edge.** A well-built HR over a space with
   no signal selects for luck and regime fit, which then fails forward.

## What would change the answer

Only new information. Every experiment here used public OHLCV and funding —
the most efficient, most arbitraged data in crypto. An edge, if one exists for
a small participant, would have to come from data others do not have or do not
process: on-chain flows, order-book microstructure, liquidation cascades,
cross-venue dislocations. That is a different project, and most of those are
also crowded.

What would *not* change the answer: more generations, more symbols, more
compute, or a better LLM. Those were measured, and the bottleneck is the search
space, not the search.

---

## Running the experiments

All experiments are gated behind environment variables and are **deterministic
and free** — zero inference except where noted. Node 22 required
(`fnm use 22`); on Windows set `HOME="$USERPROFILE"`.

```bash
# Symbol sweep across regimes            -> reports/carry-sweep.html
RUN_SWEEP=1 pnpm exec vitest run carry-sweep.gated
node scripts/sweep-dashboard.mjs

# Walk-forward robustness                 -> reports/walkforward.html
RUN_WALKFORWARD=1 pnpm exec vitest run carry-walkforward
node scripts/walkforward-dashboard.mjs

# Firm roster over a high-funding window  -> reports/carry-firm.html
RUN_CARRY_FIRM=1 pnpm exec vitest run carry-firm.gated
node scripts/carry-firm-dashboard.mjs

# Resilience lab (skill vs luck)          -> reports/resilience.html
RUN_RESILIENCE=1 pnpm exec vitest run resilience.gated
node scripts/resilience-dashboard.mjs

# Chained era evolution                   -> reports/era-evolution.html
RUN_ERA=1 pnpm exec vitest run era-evolution.gated
node scripts/era-dashboard.mjs

# CEO strategy evolution (REQUIRES INFERENCE — costs credit)
RUN_CARRY_EVOLUTION=1 pnpm exec vitest run carry-evolution
node scripts/carry-dashboard.mjs

# Live lineage server (SSE, updates as generations complete)
node scripts/lineage-server.mjs --port 7878 --open
```

Generated reports land in `reports/` (git-ignored). Design specs and
implementation plans for every component live in `docs/superpowers/`.

## Patience gene + HR rotation (2026-08-19, live era)

Diagnosis before the change (8.5 days, $1,000 firm): 100 trades, 7% win rate,
**$37.30 paid in fees against ≈ +$3 gross** — activity was anti-correlated with
book size (52 trades → $182.97; 0 trades → $200.00 intact). Verdict: the traders
were not risking too little, they were **churning**.

Two changes shipped, both evidence-shaped rather than risk-shaped:
- **HR rotation of unevaluable seats** — a trader alive ≥ 5 days with fewer than
  5 lifetime trades is rotated out (fresh random genome hired), one per review.
  Never a performance verdict; prudence that pays is still never punished.
- **Patience gene (`minHoldBars`, 0–24)** — the exit signal is suppressed until a
  position matures. Liquidation is never suppressed. Both cohorts sample the
  same bounds.

First measurement on the same 8-day replay window, same market:

| Cohort | Before patience | With patience |
|---|---|---|
| Firm (evolved) | $966 | **$976** |
| Random control | $231 | **$736** |

The control's fivefold improvement is the finding: **the losses were fees, not
signals**. Patience does not create an edge — it stops paying for its absence,
and it lifts the honest baseline the firm has to beat far higher than before.

## Robustness sweep + a second control bug (2026-08-20, live era)

**Question:** a single 90-day backtest of the live `motor` system (`src/motor`,
the genome/HR machinery that also drives Palco — distinct from the
CEO/carry-strategist system Experiments 1–6 tested) measured the firm beating
the random control by ~0.3% over the period, ~1.2%/year annualized. Does that
hold up on windows the genome never saw, or was it one lucky draw?

**Setup:** `scripts/backtest-sweep.mjs` replays `tick()` — the exact same
deterministic pipeline, no logic duplicated — across 6 **disjoint** 90-day
windows (~1.5 years, non-overlapping so each is an independent draw), fixed
before any run executed. Two metrics reported per window: peak equity (the
"recorde geral" backtest.mjs already printed) and final equity at window end
(equity_snapshots), because peak is a running-maximum statistic that flatters
whichever cohort had more chances to spike.

**Result 1 — the original number does not replicate:**

| Window | Period | peak-edge |
|---|---|---|
| W5 | 2025-02-26 → 05-27 | −3.01% |
| W4 | 2025-05-27 → 08-25 | +0.53% |
| W3 | 2025-08-25 → 11-23 | −8.16% |
| W2 | 2025-11-23 → 2026-02-21 | +7.57% |
| W1 | 2026-02-21 → 05-22 | +1.72% |
| W0 (the original window) | 2026-05-22 → 08-20 | −0.74% |

Mean −0.35% per period (~−1.4%/year), std dev 4.76pp, firm wins 3/6 (50% —
a coin flip). **No robust edge.** Consistent with every prior experiment in
this document.

**Result 2 — final-equity showed a much bigger, and bogus, "edge":** firm beat
control on final equity in **100% of windows**, by +36% to +68% each — too
large and too uniform to be real. Traced it to the actual trade log: in one
window the evolved cohort traded 587 times over 90 days; the random control
traded **6,705 times** (11.4x). The control's decision rule was a coin flip on
literally every 5-minute bar it was flat — with leverage and 10bps-per-leg
fees, that mechanically shreds capital regardless of market direction. Every
random trader in that window ended at 0.4%–13% of its starting book. Both
cohorts *lost* money in absolute terms; the firm just bled slower, because
genome signals (momentum/reversion/breakout crossovers) are naturally sparse
while a per-bar coin flip is not. Same mechanism Experiment 5 found once
already ("~90% of the measured skill was cost discipline, not prediction"),
reappearing bigger here because final-equity accumulates it over a full
window instead of netting out at a peak.

**Fix:** `randomWantsLong` (`src/motor/cohort.ts`) now buckets `ts` so the
coin only re-flips once every `minHoldBars + 1` bars, instead of every bar —
reusing the trader's own patience gene as the cooldown rather than adding a
new tunable constant. Both cohorts already sample `minHoldBars` from the same
bounds; this just closes the gap where it only throttled exits, never entries.

| | before fix | after fix |
|---|---|---|
| final-edge (mean/window) | +62.24% (~252%/yr) | **+36.13%** (~147%/yr) |
| final-edge win rate | 100% | 100% |
| trades, one window (firm vs control) | 587 vs 6,705 (11.4x) | 587 vs 1,995 (3.4x) |
| control's final book, that window | $59.60 of $1,000 | **$330.11** of $1,000 |
| peak-edge mean | −0.97% (~−3.9%/yr), 67% win | −0.35% (~−1.4%/yr), 50% win |

The fix roughly halved the fee-churn artifact and made it more consistent
(std dev 5.6pp → 2.9pp) — but did not zero it out, because even throttled,
a coin flip still re-decides more often than sparse technical signals do.
Going further would mean picking a cooldown to make the number smaller,
which is the self-deception this document exists to avoid — so it stops here,
reusing an existing, already-validated bound instead of tuning a new one.

**Finding:** the peak-edge metric, which was never exposed to this bug,
barely moved (−0.97% → −0.35%, still a coin-flip win rate). **The headline
verdict is unchanged: no robust directional edge.** What changed is that the
live random control is now a meaningfully more honest baseline going forward
— it no longer wins by construction against any strategy that simply trades
less often than it does.

## Short-selling (2026-08-20, live era)

**Question:** the motor system was 100% long-only — in any downtrend the
firm's only move was to sit flat, structurally unable to capture roughly half
of all price action. Does closing that gap produce a real edge, or was the
search space never the bottleneck (as every prior experiment here concluded)?

**Setup:** design at
`docs/superpowers/specs/2026-08-20-motor-short-selling-design.md`.
Symmetric-automatic short: the same signal genes (momentum/meanReversion/
breakout) that voted long/flat now vote long/short/flat — no new genome
field, no schema migration, every existing persisted genome gets the
capability for free. `directional-step.ts`'s execution engine moved to a
signed `qty` (positive = long, negative = short), which generalizes the P&L
formula to both sides with no branching — the one place that needed explicit
care was the exit-fee calculation, which used unsigned `qty` and would have
paid a *negative* fee (i.e. paid the trader) on every short close if not
caught (`Math.abs`'d, with a dedicated regression test). The random control's
draw became a three-way split (long/short/flat) instead of two-way, using the
same cooldown from the entry above.

**Result — re-ran the identical 6-window sweep:**

| | before short | after short |
|---|---|---|
| peak-edge mean | −0.35% (~−1.4%/yr) | −1.19% (~−4.8%/yr) |
| peak-edge win rate | 50% | 50% |
| peak-edge std dev | 4.76pp | 2.21pp |
| final-edge mean | +36.13% (~147%/yr) | +42.35% (~172%/yr) |
| final-edge win rate | 100% | 100% |

**Finding: short-selling did not create an edge.** The clean metric (peak
equity) stayed a coin flip — 50% win rate before and after, mean edge still
indistinguishable from zero (if anything slightly more negative, well within
noise given the tighter std dev). The final-edge figure is still inflated by
the same fee-churn asymmetry documented in the entry above (the firm still
trades less often than the throttled random control) and should not be read
as a result either. Doubling the tradeable market coverage — long or short
instead of long-only — did not change the answer, for the same reason more
generations, more symbols, or more compute never did: **the bottleneck was
never which side of the market the firm could take, it's that public OHLCV
signals don't predict either direction.** Short-selling stays in the motor as
a real, tested, no-longer-missing capability — it closes an honest structural
gap — but it is not reported as a source of profit.
