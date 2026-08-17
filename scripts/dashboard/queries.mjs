function mapTrader(row) {
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
    realizedPnlCents: row.realized_pnl_cents ?? 0,
  };
}

function mapOrder(row) {
  return {
    id: row.id,
    traderId: row.trader_id,
    symbol: row.symbol,
    side: row.side,
    size: row.size,
    priceCents: row.price_cents,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function firmSummary(db) {
  const row = db
    .prepare(
      `SELECT
        SUM(CASE WHEN status = 'live' AND role = 'senior' THEN 1 ELSE 0 END) AS live_seniors,
        SUM(CASE WHEN status = 'live' AND role = 'intern' THEN 1 ELSE 0 END) AS live_interns,
        SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END) AS dead,
        COALESCE(SUM(realized_pnl_cents), 0) AS total_realized_pnl_cents,
        COALESCE(SUM(CASE WHEN status = 'live' THEN book_balance_cents ELSE 0 END), 0) AS total_book_cents
       FROM traders`,
    )
    .get();

  return {
    liveSeniors: row?.live_seniors ?? 0,
    liveInterns: row?.live_interns ?? 0,
    dead: row?.dead ?? 0,
    totalRealizedPnlCents: row?.total_realized_pnl_cents ?? 0,
    totalBookCents: row?.total_book_cents ?? 0,
  };
}

export function traderRows(db) {
  const rows = db
    .prepare(
      `SELECT *
       FROM traders
       ORDER BY
        CASE WHEN status = 'live' THEN 0 ELSE 1 END,
        realized_pnl_cents DESC`,
    )
    .all();

  return rows.map(mapTrader);
}

export function recentOrders(db, n) {
  const rows = db
    .prepare(
      `SELECT *
       FROM orders
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(n);

  return rows.map(mapOrder);
}
