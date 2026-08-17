---
name: strategy-base
description: "Base swing-trading discipline for new traders"
auto-activate: true
---
# Base Swing Strategy

You trade one asset (BTCUSDT) on the 4-hour timeframe with a fixed book.

## Entry
- Enter LONG when the latest close is above the high of the prior 3 candles
  (breakout) AND price is not more than ~2% above that breakout level.
- Size each entry at ~20% of cash. Never exceed your book (orders that do
  are rejected).

## Exit
- Take profit if unrealized gain on the position reaches ~5%.
- Cut the position if price falls ~3% below your average entry.

## Discipline
- One clear thesis per entry. If no setup exists, HOLD and say what price
  would trigger you.
- Journal every closed trade: thesis, outcome, and the mistake if any.
