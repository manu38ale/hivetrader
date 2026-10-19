import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { asset, decide, makeQuote, totalBalances } from '../src/strategy.js';
import type { Book, OpenOrder } from '../src/types.js';

const config = loadConfig({});
const book: Book = { bestBid: 0.99, bestAsk: 1.01, mid: 1, spreadPct: 0.02 };
const now = Date.parse('2026-10-01T12:00:00Z');
const balances = { hive: 100, hbd: 100 };
const open: OpenOrder = {
  id: 123, side: 'bid', sell: 5, price: 0.99, created: now, expires: now + 3600000,
};

test('defaults match strategy specification; paper is opt-out', () => {
  assert.deepEqual([
    config.pollIntervalSec, config.quoteSizePct, config.minSpreadPct, config.requoteThresholdPct,
    config.inventoryTargetHbdPct, config.skewGain, config.orderExpirationMin,
    config.toxicMovePct, config.toxicWindowMin, config.pauseMin, config.maxDailyLossHbd, config.paper,
  ], [15, 0.05, 0.01, 0.002, 0.5, 1, 60, 0.02, 10, 30, 5, true]);
  assert.equal(loadConfig({ PAPER_MODE: 'false' }).paper, false);
  for (const env of [{ PAPER_MODE: 'False' }, { QUOTE_SIZE_PCT: '2' }, { POLL_INTERVAL_SEC: '' },
    { PRICE_TICK: 'NaN' }, { RPC_NODES: 'http://localhost' }]) {
    assert.throws(() => loadConfig(env));
  }
});

test('quotes both sides with three-decimal assets and one tick improvement', () => {
  const decision = decide(book, balances, [], {}, now, config);
  assert.equal(decision.create.length, 2);
  assert.equal(decision.skew, 0);
  assert.deepEqual(decision.cancel, []);
  assert.equal(decision.create[0]!.amountToSell, '5.000 HBD');
  assert.equal(decision.create[1]!.amountToSell, '5.000 HIVE');
  for (const quote of decision.create) {
    assert.match(quote.amountToSell, /^\d+\.\d{3} (HBD|HIVE)$/);
    assert.match(quote.minToReceive, /^\d+\.\d{3} (HBD|HIVE)$/);
  }
  assert.equal(decision.create[0]!.price, makeQuote('bid', 0.990001, 5)!.price);
});

test('insufficient spread cancels resting orders and does not create', () => {
  const decision = decide({ ...book, spreadPct: 0.0099 }, balances, [open], {}, now, config);
  assert.deepEqual(decision.cancel, [123]);
  assert.deepEqual(decision.create, []);
  assert.match(decision.reason, /spread/);
  assert.equal(decide({ ...book, spreadPct: 0.01 }, balances, [], {}, now, config).create.length, 2);
});

test('inventory skew follows requested sign and formula', () => {
  const tilted = { hive: 99.8, hbd: 100.2 };
  const d = decide(book, tilted, [], {}, now, config);
  assert.ok(Math.abs(d.skew - 0.001) < 1e-10);
  assert.equal(d.create[0]!.price, makeQuote('bid', 0.990001 * (1 - d.skew), 5.01)!.price);
  assert.equal(d.create[1]!.price, makeQuote('ask', 1.009999 * (1 - d.skew), 4.99)!.price);
});

test('skew cannot turn a quote into a taker', () => {
  const decision = decide(book, { hive: 0, hbd: 100 }, [], {}, now, config);
  assert.equal(decision.create.length, 0);
  assert.match(decision.reason, /cross/);
});

test('unchanged mid holds the existing side; missing opposite side is replenished', () => {
  const orders = [open];
  const anchors = { 123: { mid: 1 } };
  const copy = JSON.stringify({ orders, anchors, book, balances });
  const decision = decide(book, balances, orders, anchors, now + 1000, config);
  assert.equal(decision.create.length, 1);
  assert.equal(decision.create[0]!.side, 'ask');
  assert.deepEqual(decision.cancel, []);
  assert.equal(JSON.stringify({ orders, anchors, book, balances }), copy);
});

test('requote only above threshold, not at threshold', () => {
  const threshold = Math.abs(1.002 / 1 - 1);
  const movedBook = { ...book, mid: 1.002 };
  const at = decide(movedBook, balances, [open], { 123: { mid: 1 } }, now,
    { ...config, requoteThresholdPct: threshold, skewGain: 0 });
  assert.deepEqual(at.cancel, []);
  const above = decide({ ...book, mid: 1.003 }, balances, [open], { 123: { mid: 1 } }, now,
    { ...config, skewGain: 0 });
  assert.deepEqual(above.cancel, [123]);
  assert.equal(above.create.length, 2);
});

test('expiration, missing metadata and duplicate orders reconcile to one per side', () => {
  for (const [orders, anchors, time] of [
    [[open], { 123: { mid: 1 } }, now + 3600000],
    [[open], {}, now],
    [[open, { ...open, id: 124 }], { 123: { mid: 1 } }, now],
  ] as const) {
    const decision = decide(book, balances, [...orders], anchors, time, { ...config, skewGain: 0 });
    assert.deepEqual(decision.cancel, orders.map(order => order.id));
    assert.equal(decision.create.filter(quote => quote.side === 'bid').length, 1);
  }
});

test('quote size includes funds locked in orders; no overspend at full size', () => {
  const free = { hive: 100, hbd: 95 };
  assert.deepEqual(totalBalances(free, [open]), balances);
  const d = decide(book, free, [open], {}, now, { ...config, quoteSizePct: 1 });
  assert.equal(d.create[0]!.amountToSell, '100.000 HBD');
  assert.equal(d.create[1]!.amountToSell, '100.000 HIVE');
});

test('pause overrides quoting and cancels all orders', () => {
  const d = decide(book, balances, [open], {}, now, config, 'daily breaker');
  assert.deepEqual(d.cancel, [123]);
  assert.deepEqual(d.create, []);
  assert.equal(d.reason, 'daily breaker');
});

test('asset rounding never exceeds sell balance or worsens quoted price', () => {
  assert.equal(asset(10.0009, 'HIVE'), '10.000 HIVE');
  assert.equal(asset(5.25, 'HBD'), '5.250 HBD');
  assert.throws(() => asset(NaN, 'HIVE'));
  assert.equal(makeQuote('bid', 1, 0.0001), undefined);
  for (const price of [0.049723, 0.25, 1, 2.34567]) {
    assert.ok(makeQuote('bid', price, 1.2349)!.price <= price);
    assert.ok(makeQuote('ask', price, 1.2349)!.price >= price);
  }
});

test('invalid book cancels; one-tick spread is not improved', () => {
  assert.deepEqual(decide({ ...book, mid: NaN }, balances, [open], {}, now, config).cancel, [123]);
  const narrow = { bestBid: 1, bestAsk: 1.000001, mid: 1.0000005, spreadPct: 0.000001 };
  const d = decide(narrow, balances, [], {}, now, { ...config, minSpreadPct: 0, skewGain: 0 });
  assert.equal(d.create[0]!.price, makeQuote('bid', 1, 5)!.price);
});
