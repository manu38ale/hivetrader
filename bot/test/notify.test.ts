import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotifier, riskNotifications } from '../src/notify.js';
import { loadConfig } from '../src/config.js';
import { checkRisk } from '../src/risk.js';

const now = Date.parse('2026-10-01T12:00:00Z');
const env = { TELEGRAM_BOT_TOKEN: '123456:test-token', TELEGRAM_CHAT_ID: '-100987654', BOT_ACTIVE_KEY: 'test-secret-placeholder' };
const config = loadConfig({});

test('missing either Telegram setting logs once and never makes requests', async context => {
  const logs: string[] = [];
  context.mock.method(console, 'log', (line: string) => { logs.push(line); });
  const fetch = context.mock.method(globalThis, 'fetch', async () => { throw new Error('No request expected'); });
  for (const settings of [{}, { TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN }, { TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID }]) {
    const before = logs.length;
    const notify = createNotifier('test-bot', settings);
    await notify('started', 'paper', now);
    await notify('stopped', 'clean shutdown', now);
    assert.equal(logs.length, before + 1);
    assert.equal(JSON.parse(logs.at(-1)!).event, 'telegram_disabled');
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('Telegram message has account, UTC event and reason; configured secrets are redacted', async context => {
  let message: { chat_id: string; text: string } | undefined;
  context.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`);
    assert.equal(init.method, 'POST');
    assert.ok(init.signal instanceof AbortSignal);
    message = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ ok: true }));
  });
  await createNotifier('test-bot', env)('started', `paper ${env.BOT_ACTIVE_KEY} ${env.TELEGRAM_BOT_TOKEN}`, now);
  assert.equal(message!.chat_id, env.TELEGRAM_CHAT_ID);
  assert.match(message!.text, /test-bot/);
  assert.match(message!.text, /2026-10-01T12:00:00.000Z/);
  assert.match(message!.text, /Event: started/);
  assert.match(message!.text, /Reason: paper/);
  assert.ok(!message!.text.includes(env.BOT_ACTIVE_KEY));
  assert.ok(!message!.text.includes(env.TELEGRAM_BOT_TOKEN));
});

test('one failed attempt can retry once and recover', async context => {
  let attempts = 0;
  const logs = context.mock.method(console, 'error', () => {});
  context.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    return attempts === 1 ? new Response('', { status: 503 }) : new Response(JSON.stringify({ ok: true }));
  });
  await createNotifier('test-bot', env)('stopped', 'clean', now);
  assert.equal(attempts, 2);
  assert.equal(logs.mock.callCount(), 0);
});

test('transport errors never escape, retry at most once and cannot leak URLs or secrets', async context => {
  const logs: string[] = [];
  context.mock.method(console, 'error', (line: string) => { logs.push(line); });
  const request = context.mock.method(globalThis, 'fetch', async () => {
    throw new Error(`Failed https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}; ${env.BOT_ACTIVE_KEY}`);
  });
  await assert.doesNotReject(createNotifier('test-bot', env)('broadcast_failed', 'confirmation uncertain', now));
  assert.equal(request.mock.callCount(), 2);
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(logs[0]!).event, 'telegram_delivery_failed');
  assert.ok(!logs.join('').includes(env.TELEGRAM_BOT_TOKEN));
  assert.ok(!logs.join('').includes(env.BOT_ACTIVE_KEY));
});

test('HTTP success with Telegram ok:false or invalid JSON is still a bounded delivery failure', async context => {
  const logs = context.mock.method(console, 'error', () => {});
  let attempts = 0;
  context.mock.method(globalThis, 'fetch', async () => {
    attempts++;
    return attempts === 1 ? new Response(JSON.stringify({ ok: false })) : new Response('invalid json');
  });
  await assert.doesNotReject(createNotifier('test-bot', env)('started', 'paper', now));
  assert.equal(attempts, 2);
  assert.equal(logs.mock.callCount(), 1);
});

test('daily loss alert includes P&L, occurs once per latch and survives serialized state', () => {
  const first = checkRisk(undefined, now, 1, 100, config).state;
  const loss = checkRisk(first, now + 1, 1, 94, config);
  const alerts = riskNotifications(first, loss.state, now + 1, loss.dailyPnl, config);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.event, 'daily_loss_halted');
  assert.match(alerts[0]!.reason, /-6.000 HBD/);
  const restored = JSON.parse(JSON.stringify(loss.state));
  const next = checkRisk(restored, now + 2, 1, 94, config);
  assert.deepEqual(riskNotifications(restored, next.state, now + 2, next.dailyPnl, config), []);
});

test('toxic pause alerts start once and end once, including restart at expiry', () => {
  const first = checkRisk(undefined, now, 1, 100, config).state;
  const pause = checkRisk(first, now + 1, 1.03, 100, config);
  assert.deepEqual(riskNotifications(first, pause.state, now + 1, 0, config).map(item => item.event), ['toxic_pause_started']);
  const during = checkRisk(pause.state, now + 1000, 1.03, 100, config);
  assert.deepEqual(riskNotifications(pause.state, during.state, now + 1000, 0, config), []);
  const restored = JSON.parse(JSON.stringify(during.state));
  const endTime = restored.pauseUntil;
  const ended = checkRisk(restored, endTime, 1.03, 100, config);
  assert.deepEqual(riskNotifications(restored, ended.state, endTime, 0, config).map(item => item.event), ['toxic_pause_ended']);
  const later = checkRisk(ended.state, endTime + 1, 1.03, 100, config);
  assert.deepEqual(riskNotifications(ended.state, later.state, endTime + 1, 0, config), []);
});
