import { describe, it, expect } from "vitest";
import { renderLineageRows, renderLineageBody, renderLineageHTML } from "../../../scripts/lineage-render.mjs";

const rec = {
  generation: 1,
  strategySkill: "carry-gen1",
  params: { enterFundingBps: 2, exitFundingBps: 0, maxHoldBars: 60, capitalFraction: 0.5, minBarsBetweenTrades: 3 },
  rationale: "Raise threshold to skip churn.",
  evalResult: { realizedPnlCents: 12345, fundingCollectedCents: 20000, feesPaidCents: 7655, closedTrades: 4, maxDrawdownCents: 800 },
  keptAsIncumbent: true,
  verdictReason: "Winner: B",
};

describe("lineage-render", () => {
  it("renders a row with net, funding, fees, params and ADOTADA", () => {
    const rows = renderLineageRows([rec]);
    expect(rows).toContain("$123.45");
    expect(rows).toContain("$200.00");
    expect(rows).toContain("$76.55");
    expect(rows).toContain("ADOTADA");
    expect(rows).toContain("Raise threshold");
    expect(rows).toContain("enter 2bps");
  });

  it("body shows the empty state with no records", () => {
    expect(renderLineageBody([])).toContain("Nenhuma geração");
  });

  it("full HTML embeds the body and a title", () => {
    const html = renderLineageHTML([rec]);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Funding-Carry");
    expect(html).toContain("carry-gen1");
  });
});
