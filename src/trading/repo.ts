import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";
import type { Book, Fill, OrderSide, Position, TraderRole, TraderRow, TraderStatus } from "./types.js";

type DatabaseType = BetterSqlite3.Database;

export function insertTrader(db: DatabaseType, t: TraderRow): void {
  db.prepare(
    `INSERT INTO traders (id, name, role, parent_id, book_balance_cents, status, generation, strategy_skill, born_at, died_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    t.id,
    t.name,
    t.role,
    t.parentId,
    t.bookBalanceCents,
    t.status,
    t.generation,
    t.strategySkill,
    t.bornAt,
    t.diedAt,
  );
}

export function getTrader(db: DatabaseType, id: string): TraderRow | undefined {
  const row = db.prepare("SELECT * FROM traders WHERE id = ?").get(id) as any | undefined;
  return row ? deserializeTraderRow(row) : undefined;
}

export function listTraders(db: DatabaseType, status?: TraderStatus): TraderRow[] {
  const query = status
    ? "SELECT * FROM traders WHERE status = ? ORDER BY born_at ASC"
    : "SELECT * FROM traders ORDER BY born_at ASC";
  const rows = (status ? db.prepare(query).all(status) : db.prepare(query).all()) as any[];
  return rows.map(deserializeTraderRow);
}

export function updateTraderBalance(db: DatabaseType, id: string, cents: number): void {
  db.prepare("UPDATE traders SET book_balance_cents = ? WHERE id = ?").run(cents, id);
}

export function setTraderStatus(
  db: DatabaseType,
  id: string,
  status: TraderStatus,
  diedAt?: string,
): void {
  db.prepare("UPDATE traders SET status = ?, died_at = ? WHERE id = ?").run(
    status,
    diedAt ?? (status === "dead" ? new Date().toISOString() : null),
    id,
  );
}

export function loadBook(db: DatabaseType, traderId: string): Book {
  const trader = getTrader(db, traderId);
  const balanceCents = trader?.bookBalanceCents ?? 0;
  const positionRows = db
    .prepare("SELECT symbol, qty, avg_entry_cents FROM positions WHERE trader_id = ? AND closed_at IS NULL")
    .all(traderId) as any[];

  const positions: Position[] = positionRows.map((r) => ({
    symbol: r.symbol,
    qty: r.qty,
    avgEntryCents: r.avg_entry_cents,
  }));

  return { balanceCents, positions };
}

export function recordOrder(
  db: DatabaseType,
  o: {
    id: string;
    traderId: string;
    symbol: string;
    side: OrderSide;
    size: number;
    priceCents: number;
    status: "filled" | "rejected";
  },
): void {
  db.prepare(
    `INSERT INTO orders (id, trader_id, symbol, side, size, price_cents, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    o.id,
    o.traderId,
    o.symbol,
    o.side,
    o.size,
    o.priceCents,
    o.status,
    new Date().toISOString(),
  );
}

export function recordFill(
  db: DatabaseType,
  f: {
    id?: string;
    orderId: string;
    traderId: string;
    priceCents: number;
    qty: number;
    filledAt?: string;
  },
): void {
  db.prepare(
    `INSERT INTO fills (id, order_id, trader_id, price_cents, qty, filled_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    f.id ?? ulid(),
    f.orderId,
    f.traderId,
    f.priceCents,
    f.qty,
    f.filledAt ?? new Date().toISOString(),
  );
}

export function syncPositions(
  db: DatabaseType,
  traderId: string,
  openPositions: Position[],
): void {
  const currentRows = db
    .prepare("SELECT id, symbol FROM positions WHERE trader_id = ? AND closed_at IS NULL")
    .all(traderId) as { id: string; symbol: string }[];

  const openSymbolSet = new Set(openPositions.map((p) => p.symbol));

  // Close positions no longer in openPositions
  for (const row of currentRows) {
    if (!openSymbolSet.has(row.symbol)) {
      db.prepare("UPDATE positions SET closed_at = datetime('now') WHERE id = ?").run(row.id);
    }
  }

  // Insert or update active positions
  for (const pos of openPositions) {
    const existing = currentRows.find((r) => r.symbol === pos.symbol);
    if (existing) {
      db.prepare(
        "UPDATE positions SET qty = ?, avg_entry_cents = ? WHERE id = ?",
      ).run(pos.qty, pos.avgEntryCents, existing.id);
    } else {
      db.prepare(
        `INSERT INTO positions (id, trader_id, symbol, qty, avg_entry_cents, opened_at, closed_at, realized_pnl_cents)
         VALUES (?, ?, ?, ?, ?, datetime('now'), NULL, 0)`,
      ).run(ulid(), traderId, pos.symbol, pos.qty, pos.avgEntryCents);
    }
  }
}

function deserializeTraderRow(row: any): TraderRow {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    parentId: row.parent_id ?? null,
    bookBalanceCents: row.book_balance_cents,
    status: row.status,
    generation: row.generation,
    strategySkill: row.strategy_skill ?? null,
    bornAt: row.born_at,
    diedAt: row.died_at ?? null,
  };
}
