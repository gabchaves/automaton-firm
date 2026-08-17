---
name: strategy-base
description: "Base quantitative swing-trading discipline for new traders"
auto-activate: true
---
# Base Swing Strategy

You trade one asset (BTCUSDT) on the 4-hour timeframe with a fixed book.

## Workflow
1. Check your book with `get_book`.
2. Compute technical indicators with `get_signals` and inspect market structure with `get_candles`.
3. Base decisions on concrete indicators (RSI, EMA trend, ATR, volume ratio) rather than raw price eyeballing.

## Entry
- Enter LONG when:
  - Price is above EMA20 (`priceCents > ema20`), AND
  - RSI14 is between 45 and 68 (momentum without being overbought), AND
  - Volume ratio is confirming (`volumeRatio20 >= 1.0`).
- Sizing: size each entry at ~20% of available cash. Never exceed your book (oversized orders are rejected).

## Exit
- Take profit: close position if unrealized gain reaches ~5% or RSI14 exceeds 75 (overbought reversal risk).
- Stop loss: cut position if price falls ~3% below average entry or drops below EMA50.

## Discipline
- Formulate a clear, indicator-backed thesis before entering. If no setup exists, HOLD and state the specific signal trigger you are waiting for.
- Journal every closed trade with `write_journal`: thesis, outcome, and mistake if any.

