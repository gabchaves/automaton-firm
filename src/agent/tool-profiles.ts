import type { AutomatonTool } from "../types.js";
import { isIdleOnlyTool } from "./idle-only-tools.js";

const TRADER_TOOLS = new Set([
  "get_candles",
  "get_price",
  "get_book",
  "place_order",
  "close_position",
  "write_journal",
  "hire_intern",
]);

export function toolsForRole(role: string, all: AutomatonTool[]): AutomatonTool[] {
  if (role !== "trader") return all;
  return all.filter((t) => TRADER_TOOLS.has(t.name) || isIdleOnlyTool(t.name));
}
