import { describe, it, expect } from "vitest";
import { renderHrReportHTML } from "../../../scripts/hr-report.mjs";

const assessments = [
  {
    traderId: "star",
    verdict: "outperform",
    excessCents: 800,
    reason: "Net $10.00 beat the baseline $2.00 by $8.00, clear of the $0.50 noise band.",
    netCents: 1000,
    baselineMedianCents: 200,
    tradesCount: 12,
  },
  {
    traderId: "laggard",
    verdict: "underperform",
    excessCents: -700,
    reason: "Net $-5.00 trailed the baseline $2.00 by $7.00, clear of the $0.50 noise band.",
    netCents: -500,
    baselineMedianCents: 200,
    tradesCount: 30,
  },
  {
    traderId: "rookie",
    verdict: "insufficient_evidence",
    excessCents: 0,
    reason: "Only 0 trade(s) (< 5 required) and the window's baseline made $0.00 — staying flat was defensible.",
    netCents: 0,
    baselineMedianCents: 0,
    tradesCount: 0,
  },
];

describe("renderHrReportHTML", () => {
  it("renders each verdict, the excess values, and the random-baseline footer", () => {
    const html = renderHrReportHTML(assessments, "2026-08-17T00:00:00Z");

    expect(html).toContain("<!doctype html>");

    // traders present
    expect(html).toContain("star");
    expect(html).toContain("laggard");
    expect(html).toContain("rookie");

    // verdict labels
    expect(html).toContain("Acima do baseline");
    expect(html).toContain("Abaixo do baseline");
    expect(html).toContain("Evidência insuficiente");

    // excess values
    expect(html).toContain("$8.00"); // star's excess
    expect(html).toContain("$-7.00"); // laggard's excess

    // best (highest excess) ranked before worst
    expect(html.indexOf("star")).toBeLessThan(html.indexOf("laggard"));

    // footer: measured against a random baseline on the same window,
    // flat-in-a-dead-window not penalised, insufficient evidence never
    // promoted/retired
    const lower = html.toLowerCase();
    expect(lower).toContain("baseline aleatório");
    expect(lower).toContain("mesma janela");
    expect(lower).toContain("não é penalizado");
    expect(lower).toContain("nunca são promovidos nem demitidos");
  });

  it("renders an empty state with no assessments", () => {
    const html = renderHrReportHTML([], "now");
    expect(html).toContain("Nenhuma avaliação");
  });
});
