import { describe, it, expect } from "vitest";
import { CARRY_ARCHETYPES, internParamsFrom } from "../../trading/carry-archetypes.js";
import { CARRY_PARAMS_SCHEMA } from "../../trading/carry-params.js";

describe("carry-archetypes", () => {
  it("has three named archetypes", () => {
    expect(CARRY_ARCHETYPES.map((a) => a.name)).toEqual(["conservador", "moderado", "agressivo"]);
  });
  it("conservador enters at higher funding than agressivo", () => {
    const c = CARRY_ARCHETYPES.find((a) => a.name === "conservador")!;
    const a = CARRY_ARCHETYPES.find((a) => a.name === "agressivo")!;
    expect(c.params.enterFundingBps).toBeGreaterThan(a.params.enterFundingBps);
  });
  it("all archetypes are schema-valid", () => {
    for (const a of CARRY_ARCHETYPES) expect(CARRY_PARAMS_SCHEMA.safeParse(a.params).success).toBe(true);
  });
  it("internParamsFrom returns a valid, slightly more eager set", () => {
    const parent = CARRY_ARCHETYPES[0].params;
    const child = internParamsFrom(parent);
    expect(CARRY_PARAMS_SCHEMA.safeParse(child).success).toBe(true);
    expect(child.enterFundingBps).toBeLessThan(parent.enterFundingBps);
  });
});
