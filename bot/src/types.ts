export type Side = 'bid' | 'ask';
export interface Balances { hive: number; hbd: number }
export interface Book {
  bestBid: number;
  bestAsk: number;
  mid: number;
  spreadPct: number;
}
export interface OpenOrder {
  id: number;
  side: Side;
  sell: number;
  price: number;
  created: number;
  expires: number;
}
export interface Quote {
  side: Side;
  price: number;
  amountToSell: string;
  minToReceive: string;
}
export interface QuoteAnchor { mid: number }
export interface Decision {
  cancel: number[];
  create: Quote[];
  reason: string;
  spreadPct: number;
  skew: number;
}
export interface Sample { time: number; mid: number }
export interface RiskState {
  day: string;
  openingEquity: number;
  halted: boolean;
  pauseUntil: number;
  samples: Sample[];
}
export interface PersistentState {
  version: 1;
  account: string;
  paper: boolean;
  lastOrderId: number;
  anchors: Record<string, QuoteAnchor>;
  risk?: RiskState;
}
