import type { BotPeriod, BotSnapshot } from '../types/bot';
import type { FillOrderOperation } from '../types/hive';

export function periodStart(period: BotPeriod, now: number): number | undefined {
  const days = { '24h': 1, '7d': 7, '30d': 30, all: 0 }[period];
  return days ? now - days * 86400000 : undefined;
}

export function calculateBotMetrics(snapshot: BotSnapshot, operations: FillOrderOperation[]) {
  if (!Number.isFinite(snapshot.mid) || snapshot.mid <= 0) throw new Error('Invalid market mid');
  let volumeHive = 0;
  let volumeHbd = 0;
  let netHive = 0;
  let netHbd = 0;
  for (const op of operations) {
    if (![op.hiveAmount, op.hbdAmount].every(amount => Number.isFinite(amount) && amount > 0)) {
      throw new Error('Invalid fill amount');
    }
    volumeHive += op.hiveAmount;
    volumeHbd += op.hbdAmount;
    if (op.currentOwner === op.openOwner) continue;
    const direction = op.type === 'buy' ? 1 : -1;
    netHive += direction * op.hiveAmount;
    netHbd -= direction * op.hbdAmount;
  }
  const totalHive = snapshot.freeHive + snapshot.reservedHive;
  const totalHbd = snapshot.freeHbd + snapshot.reservedHbd;
  return {
    totalHive, totalHbd, volumeHive, volumeHbd, netHive, netHbd,
    equityHbd: totalHbd + totalHive * snapshot.mid,
    pnlHbd: netHbd + netHive * snapshot.mid,
    fills: operations.length,
  };
}
