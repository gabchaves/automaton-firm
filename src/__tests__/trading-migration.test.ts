import { describe, it, expect } from "vitest";
import { createDatabase } from "../state/database.js";

describe("migration v12", () => {
  it("creates trading tables and bumps schema_version to >= 12", () => {
    const dbInstance = createDatabase(":memory:");
    const db = dbInstance.raw;
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain("traders");
    expect(tables).toContain("orders");
    expect(tables).toContain("positions");
    expect(tables).toContain("fills");
    const v = db.prepare("SELECT MAX(version) v FROM schema_version").get() as { v: number };
    expect(v.v).toBeGreaterThanOrEqual(12);
  });
});
