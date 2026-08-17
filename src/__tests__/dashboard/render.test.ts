import { describe, expect, it } from "vitest";
import { renderDashboardHtml } from "../../../scripts/dashboard/render.mjs";

describe("renderDashboardHtml", () => {
  it("renders a self-contained dashboard document", () => {
    const html = renderDashboardHtml(
      {
        summary: {
          liveSeniors: 1,
          liveInterns: 0,
          dead: 0,
          totalRealizedPnlCents: 1500,
          totalBookCents: 10_000,
        },
        traders: [
          {
            id: "senior-1",
            name: "Senior <One>",
            role: "senior",
            parentId: null,
            bookBalanceCents: 10_000,
            status: "live",
            generation: 0,
            realizedPnlCents: 1_500,
          },
        ],
        orders: [],
        journals: [],
      },
      "2026-08-16T00:00:00Z",
    );

    expect(html).toContain("<!doctype html");
    expect(html).toContain("Senior &lt;One&gt;");
    expect(html).toContain("$15.00");
  });
});
