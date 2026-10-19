import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { Executor, nextOrderId } from '../src/executor.js';
import { Rpc } from '../src/market.js';
import { decide } from '../src/strategy.js';
import type { PersistentState } from '../src/types.js';

test('order IDs are unique within the same millisecond and across restart/clock rollback', () => {
  const time = 1700000000000;
  const first = nextOrderId(0, time);
  assert.equal(first, 1700000000);
  assert.equal(nextOrderId(first, time), first + 1);
  assert.equal(nextOrderId(first + 1, time - 10000), first + 2);
  assert.throws(() => nextOrderId(0xffffffff, time));
});

test('paper constructs, holds and cancels without creating a client or parsing a key', async () => {
  const config = { ...loadConfig({}), account: 'test-bot' };
  const rpc = new Rpc(config.nodes);
  rpc.client = () => { throw new Error('Paper must never reach signing/RPC client'); };
  const state: PersistentState = {
    version: 1, account: config.account, paper: true, lastOrderId: 0, anchors: {},
  };
  let saves = 0;
  const executor = new Executor(config, rpc, state, async () => { saves++; }, 'invalid-key-never-read');
  executor.initializePaper({ hive: 100, hbd: 100 });
  const book = { bestBid: 0.99, bestAsk: 1.01, mid: 1, spreadPct: 0.02 };
  const decision = decide(book, executor.paperFree!, [], {}, Date.now(), config);
  await executor.execute(decision, 1, Date.now());
  assert.equal(executor.paperOrders.length, 2);
  assert.deepEqual(executor.paperFree, { hive: 95, hbd: 95 });
  await executor.execute({
    cancel: executor.paperOrders.map(order => order.id), create: [],
    reason: 'pause', spreadPct: 0, skew: 0,
  }, 1, Date.now());
  assert.deepEqual(executor.paperFree, { hive: 100, hbd: 100 });
  assert.equal(executor.paperOrders.length, 0);
  assert.equal(saves, 2);
});

test('live cannot initialize without an ACTIVE key', () => {
  const config = { ...loadConfig({ PAPER_MODE: 'false' }), account: 'test-bot' };
  assert.throws(() => new Executor(config, new Rpc(config.nodes), {
    version: 1, account: config.account, paper: false, lastOrderId: 0, anchors: {},
  }, async () => {}), /ACTIVE/);
});
