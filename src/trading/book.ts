import type { Book, Fill, Position } from "./types.js";

export function positionFor(book: Book, symbol: string): Position | undefined {
  return book.positions.find((p) => p.symbol === symbol);
}

export function applyFill(book: Book, fill: Fill): Book {
  const cost = Math.round(fill.qty * fill.priceCents);
  const existing = positionFor(book, fill.symbol);

  if (fill.side === "buy") {
    if (cost > book.balanceCents) {
      throw new Error(`insufficient balance: cost ${cost} > cash ${book.balanceCents}`);
    }
    const newQty = (existing?.qty ?? 0) + fill.qty;
    const newAvg = existing
      ? Math.round((existing.qty * existing.avgEntryCents + cost) / newQty)
      : fill.priceCents;
    const positions = existing
      ? book.positions.map((p) =>
          p.symbol === fill.symbol ? { ...p, qty: newQty, avgEntryCents: newAvg } : p,
        )
      : [...book.positions, { symbol: fill.symbol, qty: fill.qty, avgEntryCents: fill.priceCents }];
    return { balanceCents: book.balanceCents - cost, positions };
  }

  // sell
  if (!existing || existing.qty < fill.qty) {
    throw new Error(`insufficient position to sell ${fill.qty} ${fill.symbol}`);
  }
  const remaining = existing.qty - fill.qty;
  const positions =
    remaining > 1e-12
      ? book.positions.map((p) => (p.symbol === fill.symbol ? { ...p, qty: remaining } : p))
      : book.positions.filter((p) => p.symbol !== fill.symbol);
  return { balanceCents: book.balanceCents + cost, positions };
}

export function markToMarketCents(book: Book, priceBySymbol: Record<string, number>): number {
  const posValue = book.positions.reduce((sum, p) => {
    const px = priceBySymbol[p.symbol] ?? p.avgEntryCents;
    return sum + Math.round(p.qty * px);
  }, 0);
  return book.balanceCents + posValue;
}

export function realizedPnlForSell(book: Book, fill: Fill): number {
  if (fill.side !== "sell") return 0;
  const pos = book.positions.find((p) => p.symbol === fill.symbol);
  if (!pos) return 0;
  const qty = Math.min(fill.qty, pos.qty);
  return Math.round(qty * (fill.priceCents - pos.avgEntryCents));
}

