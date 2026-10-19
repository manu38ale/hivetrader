import type { FillOrderOperation } from './hive';

export type BotPeriod = '24h' | '7d' | '30d' | 'all';

export interface BotOpenOrder {
  id: number;
  side: 'buy' | 'sell';
  price: number;
  remainingHive: number;
  remainingHbd: number;
  createdAt: string;
  expiresAt: string;
}

export interface BotSnapshot {
  freeHive: number;
  freeHbd: number;
  reservedHive: number;
  reservedHbd: number;
  orders: BotOpenOrder[];
  mid: number;
  updatedAt: number;
}

export interface BotDashboardData {
  account: string;
  period: BotPeriod;
  snapshot: BotSnapshot;
  operations: FillOrderOperation[];
  historyUpdatedAt: number;
}
