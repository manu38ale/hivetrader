import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { fetchTrades, simulate } from '../src/backtest.js';
import { Rpc } from '../src/market.js';

test('simulator handles fills, mark-to-market, metrics and final locked inventory', () => {
  const config = { ...loadConfig({}), skewGain: 0, maxDailyLossHbd: 1000, toxicMovePct: 1 };
  const start = Date.parse('2026-10-01T00:00:00Z');
  const result = simulate([
    { time: start, price: 1, hive: 10, takerSellsHive: true },
    { time: start + 1000, price: 0.98, hive: 1, takerSellsHive: true },
    { time: start + 2000, price: 1.02, hive: 1, takerSellsHive: false },
  ], config, { hive: 100, hbd: 100 }, 0.02, start + 3000);
  assert.equal(result.fills, 2);
  assert.equal(result.finalInventory.hive, 100);
  assert.ok(result.finalInventory.hbd > 100);
  assert.ok(result.averageCapturedSpreadHbdPerHive! > 0);
  assert.ok(result.maxDrawdownHbd > 0);
  assert.equal(result.pnlHbd, result.finalEquityHbd - 200);
});

test('first/same-second trades cannot fill quotes created from those trades', () => {
  const start = Date.parse('2026-10-01T00:00:00Z');
  const result = simulate([
    { time: start, price: 1, hive: 1000, takerSellsHive: true },
    { time: start, price: 0.98, hive: 1000, takerSellsHive: true },
  ], { ...loadConfig({}), skewGain: 0 }, { hive: 100, hbd: 100 }, 0.02, start + 1000);
  assert.equal(result.fills, 0);
  assert.equal(result.averageCapturedSpreadPct, null);
});

test('historical pagination recursively splits saturated intervals without dropping same-second fills', async () => {
  const start = Date.parse('2026-10-01T00:00:00Z');
  const rpc = new Rpc(['https://unused.invalid']);
  const row = (time: number) => ({
    date: new Date(time).toISOString().slice(0, 19),
    current_pays: { amount: '1000', precision: 3, nai: '@@000000021' },
    open_pays: { amount: '100', precision: 3, nai: '@@000000013' },
  });
  rpc.read = async <T>(_api: string, _method: string, params: unknown): Promise<T> => {
    const { start: from, end: until } = params as { start: string; end: string };
    const wide = from !== until;
    return { trades: wide ? Array.from({ length: 1000 }, () => row(start)) : [row(Date.parse(`${from}Z`))] } as T;
  };
  const trades = await fetchTrades(rpc, start, start + 2000);
  assert.equal(trades.length, 2);
  assert.equal(trades[1]!.time, start + 1000);
  assert.equal(trades[0]!.price, 0.1);
});
