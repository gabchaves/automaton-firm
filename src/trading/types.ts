export type OrderSide = "buy" | "sell";
export type TraderRole = "senior" | "intern";
export type TraderStatus = "live" | "dead" | "promoted";

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
} // prices in integer cents

export interface Position {
  symbol: string;
  qty: number;
  avgEntryCents: number;
}

export interface Book {
  balanceCents: number;
  positions: Position[];
}

export interface Fill {
  symbol: string;
  side: OrderSide;
  qty: number;
  priceCents: number;
}

export interface Order {
  id: string;
  traderId: string;
  symbol: string;
  side: OrderSide;
  size: number;
  priceCents: number;
  status: "filled" | "rejected";
  createdAt: string;
}

export interface TraderRow {
  id: string;
  name: string;
  role: TraderRole;
  parentId: string | null;
  bookBalanceCents: number;
  status: TraderStatus;
  generation: number;
  strategySkill: string | null;
  bornAt: string;
  diedAt: string | null;
}
