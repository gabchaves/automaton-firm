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
