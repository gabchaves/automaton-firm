import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { formulateStrategy } from "../../trading/strategist.js";

class CeoScript {
  async chat() {
    return {
      content:
        "# Strategy Gen 1\n\n## Entry\nRequire 2 candles of follow-through after a breakout before entering.",
    };
  }
}

describe("formulateStrategy (CEO)", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("writes strategy-gen<N>/SKILL.md from journals + performance", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "ceo-"));
    const draft = await formulateStrategy({
      inference: new CeoScript() as any,
      generation: 1,
      priorStrategy: "# Base\nEnter on breakout.",
      summary: {
        totalTrades: 5,
        winCount: 1,
        lossCount: 4,
        winRate: 0.2,
        totalPnlCents: -30,
        mistakes: [{ mistake: "no follow-through", count: 4 }],
        theses: ["breakout"],
      },
      priorPerformance: {
        traderId: "gen0",
        strategySkill: "strategy-base",
        ticks: 17,
        finalEquityCents: 9970,
        realizedPnlCents: -30,
        closedTrades: 5,
        maxDrawdownCents: 40,
      },
      homeDir: dir,
    });
    expect(draft.name).toBe("strategy-gen1");
    expect(existsSync(draft.path)).toBe(true);
    const body = readFileSync(draft.path, "utf-8");
    expect(body).toContain("follow-through");
    expect(body).toMatch(/^---/); // has frontmatter
  });
});
