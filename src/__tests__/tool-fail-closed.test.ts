import { describe, it, expect } from "vitest";
import { executeTool } from "../agent/tools.js";

describe("executeTool fail-closed", () => {
  it("denies a dangerous tool when no policy engine is supplied", async () => {
    const tools = [
      {
        name: "place_order",
        description: "",
        parameters: {},
        riskLevel: "dangerous" as const,
        category: "vm" as const,
        execute: async () => "SHOULD NOT RUN",
      },
    ];
    const res = await executeTool("place_order", {}, tools as any, {} as any, undefined, undefined);
    expect(res.error).toMatch(/policy/i);
    expect(res.result).not.toBe("SHOULD NOT RUN");
  });
});
