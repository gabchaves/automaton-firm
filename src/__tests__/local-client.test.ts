import { describe, it, expect } from "vitest";
import { createLocalClient } from "../conway/local-client.js";

describe("LocalClient", () => {
  it("computes credit balance as starting minus spent, floored at zero", async () => {
    let spent = 0;
    const client = createLocalClient({ startingCents: 1000, getSpentCents: () => spent });
    expect(await client.getCreditsBalance()).toBe(1000);
    spent = 300;
    expect(await client.getCreditsBalance()).toBe(700);
    spent = 5000;
    expect(await client.getCreditsBalance()).toBe(0);
  });

  it("executes a shell command locally", async () => {
    const client = createLocalClient({ startingCents: 1000, getSpentCents: () => 0 });
    const res = await client.exec(process.platform === "win32" ? "cmd /c echo hi" : "echo hi");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("hi");
  });

  it("createSandbox returns a local pseudo-sandbox (empty id => local mode)", async () => {
    const client = createLocalClient({ startingCents: 1000, getSpentCents: () => 0 });
    const sb = await client.createSandbox({} as any);
    expect(sb.id).toBe("");
  });
});
