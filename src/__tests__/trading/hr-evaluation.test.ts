import { describe, it, expect } from "vitest";
import { assessTrader, rankByExcess, decideHrActions, DEFAULT_HR_CONFIG } from "../../trading/hr-evaluation.js";

const ev = (o: Partial<Parameters<typeof assessTrader>[0]> = {}) => ({
  traderId: "t1", netCents: 0, tradesCount: 10, baselineMedianCents: 0, ...o,
});

describe("assessTrader", () => {
  it("beats the baseline clearly => outperform", () => {
    const a = assessTrader(ev({ netCents: 1000, baselineMedianCents: 200 }));
    expect(a.verdict).toBe("outperform");
    expect(a.excessCents).toBe(800);
  });

  it("loses to the baseline clearly => underperform", () => {
    expect(assessTrader(ev({ netCents: -500, baselineMedianCents: 300 })).verdict).toBe("underperform");
  });

  it("inside the noise band => insufficient evidence, not a winner", () => {
    const a = assessTrader(ev({ netCents: 210, baselineMedianCents: 200 }));
    expect(a.verdict).toBe("insufficient_evidence");
  });

  it("flat in a window that offered nothing => insufficient evidence, NOT punished", () => {
    const a = assessTrader(ev({ netCents: 0, tradesCount: 0, baselineMedianCents: 0 }));
    expect(a.verdict).toBe("insufficient_evidence");
    expect(a.reason.toLowerCase()).toContain("flat");
  });

  it("flat while the window clearly paid => underperform (missed opportunity)", () => {
    const a = assessTrader(ev({ netCents: 0, tradesCount: 0, baselineMedianCents: 5000 }));
    expect(a.verdict).toBe("underperform");
    expect(a.reason.toLowerCase()).toContain("opportunit");
  });

  it("many trades but below baseline => underperform (churn is exposed)", () => {
    const a = assessTrader(ev({ netCents: 100, tradesCount: 40, baselineMedianCents: 900 }));
    expect(a.verdict).toBe("underperform");
  });
});

describe("decideHrActions", () => {
  it("promotes only outperformers, retires only evidenced underperformers, holds the rest", () => {
    const assessments = [
      assessTrader(ev({ traderId: "win", netCents: 2000, baselineMedianCents: 0 })),
      assessTrader(ev({ traderId: "lose", netCents: -900, baselineMedianCents: 100 })),
      assessTrader(ev({ traderId: "unknown", netCents: 0, tradesCount: 0, baselineMedianCents: 0 })),
    ];
    const d = decideHrActions(assessments);
    expect(d.promote).toEqual(["win"]);
    expect(d.retire).toEqual(["lose"]);
    expect(d.hold).toEqual(["unknown"]);
  });

  it("never promotes or retires an unevaluable trader", () => {
    const a = [assessTrader(ev({ traderId: "u", netCents: 10, tradesCount: 0, baselineMedianCents: 5 }))];
    const d = decideHrActions(a);
    expect(d.promote).not.toContain("u");
    expect(d.retire).not.toContain("u");
    expect(d.hold).toContain("u");
  });
});

describe("rankByExcess", () => {
  it("orders best excess first", () => {
    const a = [
      assessTrader(ev({ traderId: "a", netCents: 100 })),
      assessTrader(ev({ traderId: "b", netCents: 900 })),
    ];
    expect(rankByExcess(a).map((x) => x.traderId)).toEqual(["b", "a"]);
  });
});
