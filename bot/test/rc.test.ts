import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { PrivateKey } from '@hiveio/dhive';
import { loadConfig } from '../src/config.js';
import { Executor } from '../src/executor.js';
import { estimateRcCost, readRc, Rpc } from '../src/market.js';
import type { Decision, PersistentState } from '../src/types.js';

const now = Date.parse('2026-10-01T12:00:00Z');
const config = { ...loadConfig({ PAPER_MODE: 'false' }), account: 'test-bot' };
const decision: Decision = {
  cancel: [1],
  create: [{ side: 'bid', price: 0.5, amountToSell: '1.000 HBD', minToReceive: '2.000 HIVE' }],
  reason: 'requote', spreadPct: 0.02, skew: 0,
};
const state = (): PersistentState => ({
  version: 1, account: 'test-bot', paper: false, lastOrderId: 1, anchors: { 1: { mid: 0.5 } },
  risk: { day: '2026-10-01', openingEquity: 100, halted: false, pauseUntil: 0, samples: [] },
});
const rcAccount = (mana: string, max = '1000', time = now / 1000) => ({
  rc_accounts: [{ account: 'test-bot', rc_manabar: { current_mana: mana, last_update_time: time }, max_rc: max }],
});
const ephemeralKey = () => PrivateKey.fromSeed(randomBytes(32).toString('hex')).toString();

test('readRc requests the correct API and regenerates stored manabar in integer units', async () => {
  const rpc = new Rpc(config.nodes);
  rpc.read = async <T>(api: string, method: string, params: unknown): Promise<T> => {
    assert.equal(api, 'rc_api');
    assert.equal(method, 'find_rc_accounts');
    assert.deepEqual(params, { accounts: ['test-bot'] });
    return rcAccount('0', '1000', now / 1000 - 216000) as T;
  };
  assert.deepEqual(await readRc(rpc, 'test-bot', now), { current: 500n, max: 1000n });
});

test('RC regeneration clamps to max, supports negative mana and exact large string integers', async () => {
  const rpc = new Rpc(config.nodes);
  rpc.read = async <T>(): Promise<T> => rcAccount('0', '10000000000000000000', now / 1000 - 864000) as T;
  assert.deepEqual(await readRc(rpc, 'test-bot', now), { current: 10000000000000000000n, max: 10000000000000000000n });
  rpc.read = async <T>(): Promise<T> => rcAccount('-100') as T;
  assert.deepEqual(await readRc(rpc, 'test-bot', now), { current: 0n, max: 1000n });
  rpc.read = async <T>(): Promise<T> => rcAccount('0', '1000', now / 1000 + 10) as T;
  assert.equal((await readRc(rpc, 'test-bot', now)).current, 0n);
});

test('RC cost uses live operation statistics, actual counts and double headroom', async () => {
  const rpc = new Rpc(config.nodes);
  const methods: unknown[] = [];
  rpc.read = async <T>(_api: string, method: string, params: unknown): Promise<T> => {
    assert.equal(method, 'get_rc_operation_stats');
    methods.push(params);
    const { operation } = params as { operation: string };
    return { count: 10, avg_cost_rc: operation === 'limit_order_create_operation' ? '100' : '40' } as T;
  };
  assert.equal(await estimateRcCost(rpc, ['limit_order_create', 'limit_order_cancel', 'limit_order_create']), 480n);
  assert.equal(methods.length, 2);
});

test('zero mana skips the transaction without broadcast, ID/anchor mutations, alerts or risk halt', async context => {
  const logs: string[] = [];
  context.mock.method(console, 'error', (line: string) => { logs.push(line); });
  const rpc = new Rpc(config.nodes);
  rpc.read = async <T>(_api: string, method: string): Promise<T> => {
    assert.equal(method, 'find_rc_accounts');
    return rcAccount('0', '0', Math.floor(Date.now() / 1000)) as T;
  };
  rpc.client = () => { throw new Error('Must not broadcast'); };
  const stored = state();
  const before = JSON.stringify(stored);
  let saves = 0;
  let notifications = 0;
  const executor = new Executor(config, rpc, stored, async () => { saves++; }, ephemeralKey(), async () => { notifications++; });
  assert.equal(await executor.execute(decision, 0.5, now), 'insufficient_rc');
  assert.equal(JSON.stringify(stored), before);
  assert.equal(stored.risk!.halted, false);
  assert.equal(saves, 1);
  assert.equal(notifications, 0);
  assert.deepEqual(logs, ['insufficient RC: 0/0']);
});

test('positive mana below cost estimate also skips without latching', async context => {
  context.mock.method(console, 'error', () => {});
  const rpc = new Rpc(config.nodes);
  rpc.read = async <T>(_api: string, method: string): Promise<T> =>
    (method === 'find_rc_accounts' ? rcAccount('100', '100', Math.floor(Date.now() / 1000)) : { count: 1, avg_cost_rc: 100 }) as T;
  rpc.client = () => { throw new Error('Must not broadcast'); };
  const stored = state();
  const executor = new Executor(config, rpc, stored, async () => {}, ephemeralKey());
  assert.equal(await executor.execute(decision, 0.5, now), 'insufficient_rc');
  assert.equal(stored.risk!.halted, false);
  assert.equal(stored.lastOrderId, 1);
});

test('unavailable RC or cost data is fail-closed, not a broadcast failure latch', async context => {
  context.mock.method(console, 'error', () => {});
  const rpc = new Rpc(config.nodes);
  rpc.read = async () => { throw new Error('RPC unavailable'); };
  rpc.client = () => { throw new Error('Must not broadcast'); };
  const stored = state();
  const executor = new Executor(config, rpc, stored, async () => {}, ephemeralKey());
  assert.equal(await executor.execute(decision, 0.5, now), 'rc_unavailable');
  assert.equal(stored.risk!.halted, false);
});

test('actual broadcast failure after RC succeeds latches risk and sends a sanitized notification', async context => {
  const rpc = new Rpc(config.nodes);
  const client = rpc.client();
  rpc.read = async <T>(_api: string, method: string): Promise<T> =>
    (method === 'find_rc_accounts' ? rcAccount('1000', '1000', Math.floor(Date.now() / 1000)) : { count: 1, avg_cost_rc: 100 }) as T;
  rpc.client = () => client;
  const send = context.mock.method(client.broadcast, 'sendOperations', async () => { throw new Error('Private transport diagnostic'); });
  const events: string[] = [];
  const stored = state();
  const executor = new Executor(config, rpc, stored, async () => {}, ephemeralKey(), async (event, reason) => {
    events.push(event);
    assert.ok(!reason.includes('Private transport diagnostic'));
  });
  await assert.rejects(executor.execute(decision, 0.5, now), /Broadcast failed or uncertain/);
  assert.equal(send.mock.callCount(), 1);
  assert.equal(stored.risk!.halted, true);
  assert.deepEqual(events, ['broadcast_failed']);
});

test('RC exactly equal to threshold permits the original atomic cancel/create transaction', async context => {
  const rpc = new Rpc(config.nodes);
  const client = rpc.client();
  rpc.read = async <T>(_api: string, method: string): Promise<T> =>
    (method === 'find_rc_accounts' ? rcAccount('400', '400', Math.floor(Date.now() / 1000)) : { count: 1, avg_cost_rc: 100 }) as T;
  rpc.client = () => client;
  const send = context.mock.method(client.broadcast, 'sendOperations', async () => ({ id: 'test', block_num: 1, trx_num: 0, expired: false }));
  const stored = state();
  const executor = new Executor(config, rpc, stored, async () => {}, ephemeralKey());
  assert.equal(await executor.execute(decision, 0.5, now), 'broadcast');
  assert.deepEqual(send.mock.calls[0]!.arguments[0].map(op => op[0]), ['limit_order_cancel', 'limit_order_create']);
  assert.equal(stored.risk!.halted, false);
});
