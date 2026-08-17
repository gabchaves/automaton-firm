import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import type { AutomatonDatabase } from "../types.js";
import type { TraderRow } from "./types.js";
import type { CarryBar, CarryParams } from "./carry-types.js";
import { initCarryState, stepCarry, type CarryState } from "./carry-engine.js";
import { CARRY_ARCHETYPES, internParamsFrom } from "./carry-archetypes.js";
import { insertTrader, listTraders, updateTraderBalance, addRealizedPnl } from "./repo.js";
import { deathSweep } from "./firm.js";

export interface CarryTraderStat {
  traderId: string;
  archetype: string;
  cycles: number;
  fundingCents: number;
  feesCents: number;
}

export interface CarryFirmResult {
  bars: number;
  traders: TraderRow[];
  stats: Record<string, CarryTraderStat>;
}

interface LiveCarry {
  state: CarryState;
  params: CarryParams;
}

export function runCarryFirm(deps: {
  db: AutomatonDatabase;
  bars: CarryBar[];
  seniorStartCents: number;
  seniorFloor?: number;
  hireProfitCents?: number;
  internStakeCents?: number;
  retainFloorCents?: number;
  homeDir?: string;
  mkId?: () => string;
}): CarryFirmResult {
  const raw = deps.db.raw;
  const seniorFloor = deps.seniorFloor ?? 3;
  const hireProfit = deps.hireProfitCents ?? 1000;
  const stake = deps.internStakeCents ?? 200;
  const retainFloor = deps.retainFloorCents ?? 300;
  const mkId = deps.mkId ?? (() => ulid());
  const home = deps.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();

  const carry = new Map<string, LiveCarry>();
  const stats = new Map<string, CarryTraderStat>();
  let archetypeCursor = 0;

  const spawnSenior = (at: string): void => {
    const arch = CARRY_ARCHETYPES[archetypeCursor++ % CARRY_ARCHETYPES.length];
    const id = mkId();
    const row: TraderRow = {
      id,
      name: `senior-${arch.name}-${id.slice(0, 6)}`,
      role: "senior",
      parentId: null,
      bookBalanceCents: deps.seniorStartCents,
      status: "live",
      generation: 0,
      strategySkill: arch.name,
      bornAt: at,
      diedAt: null,
      realizedPnlCents: 0,
    };
    insertTrader(raw, row);
    carry.set(id, { state: initCarryState(), params: arch.params });
    stats.set(id, { traderId: id, archetype: arch.name, cycles: 0, fundingCents: 0, feesCents: 0 });
  };

  const t0 = deps.bars.length ? new Date(deps.bars[0].time).toISOString() : new Date(0).toISOString();
  for (let i = 0; i < seniorFloor; i++) spawnSenior(t0);

  for (let t = 0; t < deps.bars.length; t++) {
    const bar = deps.bars[t];
    const at = new Date(bar.time).toISOString();

    // 1. Advance each live trader one carry step.
    for (const trader of listTraders(raw, "live")) {
      const lc = carry.get(trader.id);
      if (!lc) continue;
      const r = stepCarry(lc.state, bar, lc.params, { barIndex: t, equityCents: trader.bookBalanceCents });
      lc.state = r.state;
      const delta = r.fundingCents - r.feesCents;
      if (delta !== 0) {
        updateTraderBalance(raw, trader.id, trader.bookBalanceCents + delta);
        addRealizedPnl(raw, trader.id, delta);
      }
      const st = stats.get(trader.id);
      if (st) {
        st.fundingCents += r.fundingCents;
        st.feesCents += r.feesCents;
        if (r.closedCycle) st.cycles += 1;
      }
    }

    // 2. RH: death sweep (book <= 0). Rare in v1 — delta-neutral carry does not ruin.
    for (const id of deathSweep(raw, at)) carry.delete(id);

    // 3. RH: backfill seniors to the floor.
    let liveSeniors = listTraders(raw, "live").filter((tr) => tr.role === "senior").length;
    while (liveSeniors < seniorFloor) {
      spawnSenior(at);
      liveSeniors++;
    }

    // 4. RH: intern hiring.
    for (const senior of listTraders(raw, "live").filter((tr) => tr.role === "senior")) {
      if (senior.realizedPnlCents < hireProfit) continue;
      if (senior.bookBalanceCents - stake < retainFloor) continue;
      const hasIntern = listTraders(raw, "live").some((tr) => tr.role === "intern" && tr.parentId === senior.id);
      if (hasIntern) continue;

      const arch = senior.strategySkill ?? "moderado";
      const parentLc = carry.get(senior.id);
      const parentParams = parentLc?.params ?? CARRY_ARCHETYPES[1].params;
      const internId = mkId();
      const internRow: TraderRow = {
        id: internId,
        name: `intern-${arch}-${internId.slice(0, 6)}`,
        role: "intern",
        parentId: senior.id,
        bookBalanceCents: stake,
        status: "live",
        generation: senior.generation + 1,
        strategySkill: arch,
        bornAt: at,
        diedAt: null,
        realizedPnlCents: 0,
      };
      updateTraderBalance(raw, senior.id, senior.bookBalanceCents - stake);
      insertTrader(raw, internRow);
      carry.set(internId, { state: initCarryState(), params: internParamsFrom(parentParams) });
      stats.set(internId, { traderId: internId, archetype: arch, cycles: 0, fundingCents: 0, feesCents: 0 });
    }
  }

  const statsObj: Record<string, CarryTraderStat> = {};
  for (const [id, st] of stats) statsObj[id] = st;
  const statsPath = path.join(home, ".automaton", "carry-firm-stats.json");
  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  fs.writeFileSync(statsPath, JSON.stringify(statsObj, null, 2), "utf-8");

  return { bars: deps.bars.length, traders: listTraders(raw), stats: statsObj };
}
