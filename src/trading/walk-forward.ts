export interface WindowResult {
  label: string;
  totalPnlCents: number;
  worstDrawdownCents: number;
  bars: number;
  profitable: boolean;
}

export interface WalkForwardSummary {
  windows: number;
  profitableWindows: number;
  pctProfitable: number;
  worstDrawdownCents: number;
  totalPnlCents: number;
}

export function summarizeWalkForward(results: WindowResult[]): WalkForwardSummary {
  if (results.length === 0) {
    return {
      windows: 0,
      profitableWindows: 0,
      pctProfitable: 0,
      worstDrawdownCents: 0,
      totalPnlCents: 0,
    };
  }

  const profitableWindows = results.filter((r) => r.profitable).length;
  const pctProfitable = (profitableWindows / results.length) * 100;
  const worstDrawdownCents = Math.max(...results.map((r) => r.worstDrawdownCents || 0));
  const totalPnlCents = results.reduce((sum, r) => sum + (r.totalPnlCents || 0), 0);

  return {
    windows: results.length,
    profitableWindows,
    pctProfitable,
    worstDrawdownCents,
    totalPnlCents,
  };
}
