import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateBotMetrics, periodStart } from '../../src/utils/botMetrics.js';
import { BotDataError, fetchBotOperations, fetchBotSnapshot, parseBotOrders } from '../../src/utils/botApi.js';
import type { BotSnapshot } from '../../src/types/bot.js';
import type { FillOrderOperation } from '../../src/types/hive.js';

const snapshot: BotSnapshot = {
  freeHive: 100, freeHbd: 10, reservedHive: 20, reservedHbd: 5,
  orders: [], mid: 0.5, updatedAt: 0,
};
const fill = (type: 'buy' | 'sell', hive: number, hbd: number): FillOrderOperation => ({
  type, hiveAmount: hive, hbdAmount: hbd, price: hbd / hive,
  timestamp: '2026-10-01T12:00:00.000Z', currentOwner: 'test-bot', openOwner: 'other',
});
const chainOrder = (side: 'buy' | 'sell', id: number) => ({
  orderid: id, for_sale: side === 'buy' ? 1500 : 10000,
  sell_price: side === 'buy' ? { base: '1.000 HBD', quote: '20.000 HIVE' }
    : { base: '10.000 HIVE', quote: '0.600 HBD' },
  created: '2026-10-01T00:00:00', expiration: '2026-10-02T00:00:00',
});
const chainFill = (time: string, buy: boolean) => ({
  timestamp: time,
  op: ['fill_order', {
    current_owner: 'test-bot', open_owner: 'other',
    current_pays: buy ? '2.000 HBD' : '10.000 HIVE',
    open_pays: buy ? '10.000 HIVE' : '3.000 HBD',
  }],
});
const response = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));

test('bot summary includes reserved funds once and reports gross volumes in both assets', () => {
  assert.deepEqual(calculateBotMetrics(snapshot, [fill('buy', 10, 4), fill('sell', 4, 3)]), {
    totalHive: 120, totalHbd: 15, volumeHive: 14, volumeHbd: 7,
    netHive: 6, netHbd: -1, equityHbd: 75, pnlHbd: 2, fills: 2,
  });
});

test('trading P&L marks open position at internal mid, not cash flow, feed or USD', () => {
  const operations = [fill('buy', 10, 4), fill('sell', 4, 3)];
  assert.equal(calculateBotMetrics({ ...snapshot, mid: 0.25 }, operations).pnlHbd, 0.5);
  assert.equal(calculateBotMetrics({ ...snapshot, mid: 0.1 }, operations).pnlHbd, -0.3999999999999999);
});

test('funding and pre-existing balances do not become trading profits without fills', () => {
  const metrics = calculateBotMetrics({ ...snapshot, freeHive: 10000, freeHbd: 10000 }, []);
  assert.equal(metrics.pnlHbd, 0);
  assert.equal(metrics.volumeHbd, 0);
  assert.equal(metrics.fills, 0);
  assert.ok(metrics.equityHbd > 10000);
});

test('a self fill has gross volume but no net inventory change or trading profit', () => {
  const metrics = calculateBotMetrics(snapshot, [{ ...fill('buy', 10, 4), openOwner: 'test-bot' }]);
  assert.equal(metrics.volumeHbd, 4);
  assert.equal(metrics.volumeHive, 10);
  assert.equal(metrics.pnlHbd, 0);
});

test('rolling periods use milliseconds and all-history has no cutoff', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  assert.equal(periodStart('24h', now), now - 86400000);
  assert.equal(periodStart('7d', now), now - 7 * 86400000);
  assert.equal(periodStart('30d', now), now - 30 * 86400000);
  assert.equal(periodStart('all', now), undefined);
});

test('open order amounts respect sold asset and remaining for_sale, not original order size', () => {
  const orders = parseBotOrders([chainOrder('buy', 1), chainOrder('sell', 2)]);
  assert.equal(orders[0]!.remainingHbd, 1.5);
  assert.equal(orders[0]!.remainingHive, 30);
  assert.equal(orders[1]!.remainingHive, 10);
  assert.equal(orders[1]!.remainingHbd, 0.6);
  assert.equal(orders[0]!.side, 'buy');
  assert.equal(orders[1]!.side, 'sell');
  assert.equal(orders[0]!.expiresAt, '2026-10-02T00:00:00.000Z');
  assert.throws(() => parseBotOrders([chainOrder('buy', 1), chainOrder('buy', 1)]), BotDataError);
  assert.throws(() => parseBotOrders([{ ...chainOrder('buy', 1), for_sale: -1 }]), BotDataError);
});

test('snapshot reads real balances, reservations and internal book mid, without a reference feed', async context => {
  const methods: string[] = [];
  context.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    methods.push(request.method);
    if (request.method === 'condenser_api.get_accounts') {
      return response([{ name: 'test-bot', balance: '100.000 HIVE', hbd_balance: '10.000 HBD' }]);
    }
    if (request.method === 'condenser_api.get_open_orders') return response([chainOrder('buy', 1), chainOrder('sell', 2)]);
    if (request.method === 'condenser_api.get_order_book') {
      return response({
        bids: [{ real_price: '0.049', hive: 1000, hbd: 49 }],
        asks: [{ real_price: '0.051', hive: 1000, hbd: 51 }],
      });
    }
    throw new Error('Unexpected price source');
  });
  const data = await fetchBotSnapshot('test-bot', new AbortController().signal);
  assert.equal(data.mid, 0.05);
  assert.equal(data.reservedHbd, 1.5);
  assert.equal(data.reservedHive, 10);
  assert.equal(data.freeHbd, 10);
  assert.equal(data.freeHive, 100);
  assert.equal(methods.length, 3);
});

test('history paginates through index zero, preserving distinct same-time fills and directions', async context => {
  context.mock.method(console, 'log', () => {});
  const starts: number[] = [];
  context.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const start: number = request.params[1];
    starts.push(start);
    if (start === -1) return response(Array.from({ length: 1000 }, (_, i) => [
      i + 1, i === 0 ? chainFill('2026-10-01T12:00:00', false)
        : { timestamp: '2026-10-01T12:00:00', op: ['transfer', {}] },
    ]));
    assert.equal(request.params[2], 1);
    return response([[0, chainFill('2026-10-01T12:00:00', true)]]);
  });
  const operations = await fetchBotOperations('test-bot', undefined, new AbortController().signal);
  assert.deepEqual(starts, [-1, 0]);
  assert.equal(operations.length, 2);
  assert.equal(operations[0]!.timestamp, '2026-10-01T12:00:00.000Z');
  assert.deepEqual(new Set(operations.map(op => op.type)), new Set(['buy', 'sell']));
});

test('history cutoff is inclusive and filters in UTC regardless of browser timezone', async context => {
  context.mock.method(console, 'log', () => {});
  context.mock.method(globalThis, 'fetch', async () => response([
    [0, chainFill('2026-10-01T11:59:59', true)],
    [1, chainFill('2026-10-01T12:00:00', true)],
    [2, chainFill('2026-10-01T12:00:01', false)],
  ]));
  const operations = await fetchBotOperations('test-bot', Date.parse('2026-10-01T12:00:00Z'), new AbortController().signal);
  assert.equal(operations.length, 2);
});

test('an incomplete subsequent page rejects rather than showing a partial P&L', async context => {
  context.mock.method(console, 'log', () => {});
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async () => response(
    calls++ === 0 ? [[5, chainFill('2026-10-01T12:00:00', true)]] : [],
  ));
  await assert.rejects(fetchBotOperations('test-bot', undefined, new AbortController().signal), BotDataError);
});

test('malformed fill assets and aborted requests are explicit errors', async context => {
  context.mock.method(globalThis, 'fetch', async () => response([[0, {
    timestamp: '2026-10-01T12:00:00',
    op: ['fill_order', { current_owner: 'test-bot', open_owner: 'other', current_pays: '1.000 USD', open_pays: '1.000 HIVE' }],
  }]]));
  await assert.rejects(fetchBotOperations('test-bot', undefined, new AbortController().signal), BotDataError);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchBotOperations('test-bot', undefined, controller.signal), { name: 'AbortError' });
});
