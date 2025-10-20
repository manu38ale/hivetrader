import { FillOrderOperation, TradingSummary } from '../types/hive';

export function calculateTradingSummary(operations: FillOrderOperation[]): TradingSummary {
  let totalHbdSpent = 0;
  let totalHbdReceived = 0;

  for (const operation of operations) {
    if (operation.type === 'buy') {
      totalHbdSpent += operation.hbdAmount;
    } else {
      totalHbdReceived += operation.hbdAmount;
    }
  }

  return {
    totalHbdSpent,
    totalHbdReceived,
    netProfitLoss: totalHbdReceived - totalHbdSpent,
    totalOperations: operations.length
  };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  }).format(amount);
}

export function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(price);
}