import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, getTrader } from "../../trading/repo.js";
import { PaperSimulator } from "../../trading/simulator.js";
import { createTradingTools } from "../../trading/tools.js";
import type { PriceFeed } from "../../trading/feed.js";

const feed: PriceFeed = {
  async getCandles() {
    return [];
  },
  async getPrice() {
    return 5_000_000;
  },
};

function ctx(db: any) {
  return {
    identity: { sandboxId: "" },
    config: {},
    db: { raw: db },
    conway: {
      writeFile: async () => {},
      readFile: async () => "",
    },
    inference: {},
  } as any;
}

describe("trading tools", () => {
  it("place_order fills and get_book reflects it", async () => {
    const dbInstance = createDatabase(":memory:");
    const db = dbInstance.raw;
    insertTrader(db, {
      id: "t1",
      name: "a",
      role: "senior",
      parentId: null,
      bookBalanceCents: 10_000,
      status: "live",
      generation: 0,
      strategySkill: null,
      bornAt: new Date().toISOString(),
      diedAt: null,
    });
    const sim = new PaperSimulator(db, feed);
    const tools = createTradingTools(sim, feed);
    const place = tools.find((t) => t.name === "place_order")!;
    const out = await place.execute(
      { traderId: "t1", symbol: "BTCUSDT", side: "buy", qty: 0.001 },
      ctx(db),
    );
    expect(out).toMatch(/filled|ok/i);
  });
});

describe("hire_intern ground-truth enforcement", () => {
  function seedSenior(db: any, id: string, balanceCents: number) {
    insertTrader(db, {
      id, name: id, role: "senior", parentId: null, bookBalanceCents: balanceCents,
      status: "live", generation: 0, strategySkill: null,
      bornAt: new Date().toISOString(), diedAt: null,
    });
  }
  function hireTool() {
    const sim = new PaperSimulator(createDatabase(":memory:").raw, feed);
    return createTradingTools(sim, feed).find((t) => t.name === "hire_intern")!;
  }

  it("denies hiring below the $10 threshold", async () => {
    const db = createDatabase(":memory:").raw;
    seedSenior(db, "s1", 900); // below 1000
    const out = await hireTool().execute({ traderId: "s1", name: "i1", stakeCents: 200 }, ctx(db));
    expect(out).toMatch(/threshold/i);
  });

  it("denies a stake below the $2 minimum", async () => {
    const db = createDatabase(":memory:").raw;
    seedSenior(db, "s1", 1000);
    const out = await hireTool().execute({ traderId: "s1", name: "i1", stakeCents: 100 }, ctx(db));
    expect(out).toMatch(/minimum/i);
  });

  it("denies a stake that breaks the $3 retain floor", async () => {
    const db = createDatabase(":memory:").raw;
    seedSenior(db, "s1", 1000);
    const out = await hireTool().execute({ traderId: "s1", name: "i1", stakeCents: 800 }, ctx(db)); // retains 200 < 300
    expect(out).toMatch(/retain|floor/i);
  });

  it("allows a valid hire and debits the leader's book", async () => {
    const dbi = createDatabase(":memory:");
    const db = dbi.raw;
    seedSenior(db, "s1", 1000);
    const sim = new PaperSimulator(db, feed);
    const tool = createTradingTools(sim, feed).find((t) => t.name === "hire_intern")!;
    const out = await tool.execute({ traderId: "s1", name: "i1", stakeCents: 200 }, ctx(db));
    expect(out).toMatch(/"ok":true/);
    const leader = getTrader(db, "s1")!;
    expect(leader.bookBalanceCents).toBe(800);
  });

  it("enforces the cap of 1 live intern per senior", async () => {
    const dbi = createDatabase(":memory:");
    const db = dbi.raw;
    seedSenior(db, "s1", 5000);
    const sim = new PaperSimulator(db, feed);
    const tool = createTradingTools(sim, feed).find((t) => t.name === "hire_intern")!;
    await tool.execute({ traderId: "s1", name: "i1", stakeCents: 200 }, ctx(db));
    const second = await tool.execute({ traderId: "s1", name: "i2", stakeCents: 200 }, ctx(db));
    expect(second).toMatch(/cap/i);
  });
});
