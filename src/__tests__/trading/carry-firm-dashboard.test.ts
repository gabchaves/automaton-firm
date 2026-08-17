import { describe, it, expect } from "vitest";
import { renderFirmRosterHTML } from "../../../scripts/carry-firm-dashboard.mjs";

const traders = [
  { id: "a", name: "senior-moderado-a", role: "senior", parentId: null, bookBalanceCents: 105000, status: "live", generation: 0, strategySkill: "moderado", realizedPnlCents: 5000 },
  { id: "b", name: "intern-moderado-b", role: "intern", parentId: "a", bookBalanceCents: 2200, status: "live", generation: 1, strategySkill: "moderado", realizedPnlCents: 200 },
];
const stats = {
  a: { archetype: "moderado", cycles: 4, fundingCents: 6000, feesCents: 1000 },
  b: { archetype: "moderado", cycles: 1, fundingCents: 300, feesCents: 100 },
};

describe("carry-firm-dashboard render", () => {
  it("shows each employee's realized PnL, role, archetype and cycles", () => {
    const html = renderFirmRosterHTML(traders, stats, "2026-08-17T00:00:00Z");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("$50.00"); // senior realized pnl
    expect(html).toContain("$2.00"); // intern realized pnl
    expect(html).toContain("moderado");
    expect(html).toContain("intern-moderado-b");
    expect(html).toContain("senior-moderado-a");
  });
  it("renders an empty state with no traders", () => {
    expect(renderFirmRosterHTML([], {}, "now")).toContain("Nenhum funcionário");
  });
});
