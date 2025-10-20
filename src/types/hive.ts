export interface FillOrderOperation {
  timestamp: string;
  type: 'buy' | 'sell';
  hiveAmount: number;
  hbdAmount: number;
  price: number;
  currentOwner: string;
  openOwner: string;
}

export interface TradingSummary {
  totalHbdSpent: number;
  totalHbdReceived: number;
  netProfitLoss: number;
  totalOperations: number;
}

export interface PriceData {
  hive: { usd: number };
  hive_dollar: { usd: number };
}

export interface DateFilter {
  startDate: Date | null;
  endDate: Date | null;
}

export interface DebugInfo {
  totalHistoryEntries: number;
  totalApiCalls: number;
  fillOrdersFound: number;
  manuphotosInvolved: number;
  validOperations: number;
  sampleOperations: any[];
}