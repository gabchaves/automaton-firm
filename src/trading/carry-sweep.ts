const BARS_PER_DAY = 3; // 8h funding bars

export interface SweepRow {
  symbol: string;
  window: string;
  bars: number;
  totalPnlCents: number;
  worstDrawdownCents: number;
  skipped?: string;
}

export interface SymbolSummary {
  symbol: string;
  windows: number;
  profitableWindows: number;
  pctProfitable: number;
  totalPnlCents: number;
  worstDrawdownCents: number;
  annualizedPct: number;
  skippedWindows: string[];
}

/**
 * Simple (non-compounded) annualization of a window return. Non-compounded is the
 * honest choice here: carry cycles are sparse and we do not reinvest across windows,
 * so compounding would overstate the edge.
 */
export function annualizedPct(pnlCents: number, capitalCents: number, bars: number): number {
  if (bars <= 0 || capitalCents <= 0) return 0;
  const days = bars / BARS_PER_DAY;
  const windowPct = (pnlCents / capitalCents) * 100;
  return windowPct * (365 / days);
}

export function summarizeSymbolSweep(rows: SweepRow[], capitalCents: number): SymbolSummary[] {
  const order: string[] = [];
  const bySymbol = new Map<string, SweepRow[]>();
  for (const r of rows) {
    if (!bySymbol.has(r.symbol)) {
      bySymbol.set(r.symbol, []);
      order.push(r.symbol);
    }
    bySymbol.get(r.symbol)!.push(r);
  }

  return order.map((symbol) => {
    const all = bySymbol.get(symbol)!;
    const ran = all.filter((r) => !r.skipped);
    const skippedWindows = all.filter((r) => r.skipped).map((r) => `${r.window}: ${r.skipped}`);
    const totalPnlCents = ran.reduce((s, r) => s + r.totalPnlCents, 0);
    const totalBars = ran.reduce((s, r) => s + r.bars, 0);
    const worstDrawdownCents = ran.reduce((m, r) => Math.max(m, r.worstDrawdownCents), 0);
    const profitableWindows = ran.filter((r) => r.totalPnlCents > 0).length;
    return {
      symbol,
      windows: ran.length,
      profitableWindows,
      pctProfitable: ran.length > 0 ? (profitableWindows / ran.length) * 100 : 0,
      totalPnlCents,
      worstDrawdownCents,
      annualizedPct: annualizedPct(totalPnlCents, capitalCents, totalBars),
      skippedWindows,
    };
  });
}
