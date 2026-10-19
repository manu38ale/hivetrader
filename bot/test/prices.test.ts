import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchCurrentPrices, pricesFromMedianFeed } from '../../src/utils/priceApi.js';

test('on-chain feed prices use HBD/HIVE units and reciprocal, not USD', () => {
  assert.deepEqual(pricesFromMedianFeed({ base: '0.051 HBD', quote: '1.000 HIVE' }), {
    hiveInHbd: 0.051, hbdInHive: 1 / 0.051,
  });
  assert.deepEqual(pricesFromMedianFeed({ base: '40.000 HIVE', quote: '2.000 HBD' }), {
    hiveInHbd: 0.05, hbdInHive: 20,
  });
});

test('invalid, zero or non-HIVE/HBD feeds are rejected without invented prices', () => {
  for (const feed of [
    { base: '0.000 HBD', quote: '1.000 HIVE' },
    { base: '1.000 HBD', quote: '0.000 HIVE' },
    { base: '1.000 HIVE', quote: '1.000 HIVE' },
    { base: '1.000 USD', quote: '1.000 HIVE' },
    { base: '-1.000 HBD', quote: '1.000 HIVE' },
    { base: 'NaN HBD', quote: '1.000 HIVE' },
  ]) assert.throws(() => pricesFromMedianFeed(feed));
});

test('reference prices request only Hive median feed RPC', async context => {
  const calls: { url: string; body: unknown }[] = [];
  context.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({
      jsonrpc: '2.0', id: 1, result: { base: '0.051 HBD', quote: '1.000 HIVE' },
    }));
  });
  assert.equal((await fetchCurrentPrices()).hbdInHive, 1 / 0.051);
  assert.deepEqual(calls, [{
    url: 'https://api.hive.blog',
    body: { jsonrpc: '2.0', method: 'condenser_api.get_current_median_history_price', params: [], id: 1 },
  }]);
});

test('RPC failures and malformed responses propagate instead of using fallback prices', async context => {
  context.mock.method(console, 'error', () => {});
  for (const response of [
    new Response('Unavailable', { status: 503 }),
    new Response(JSON.stringify({ error: { message: 'Feed unavailable' } })),
    new Response(JSON.stringify({ result: { base: null, quote: '1.000 HIVE' } })),
  ]) {
    const fetchMock = context.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(fetchCurrentPrices());
    fetchMock.mock.restore();
  }
});
