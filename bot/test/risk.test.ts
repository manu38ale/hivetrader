import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';
import { checkRisk } from '../src/risk.js';

const config = loadConfig({});
const now = Date.parse('2026-10-01T23:50:00Z');

test('first observation initializes mark-to-market daily baseline', () => {
  const result = checkRisk(undefined, now, 1, 100, config);
  assert.equal(result.dailyPnl, 0);
  assert.equal(result.reason, undefined);
  assert.equal(result.state.day, '2026-10-01');
});

test('daily loss is in HBD, strict threshold, and latched across restart and UTC rollover', () => {
  const first = checkRisk(undefined, now, 1, 100, config).state;
  assert.equal(checkRisk(first, now + 1, 1, 95, config).reason, undefined);
  const halted = checkRisk(first, now + 2, 1, 94.999, config);
  assert.equal(halted.state.halted, true);
  const restored = JSON.parse(JSON.stringify(halted.state));
  const next = checkRisk(restored, now + 86400000, 1, 110, config);
  assert.equal(next.dailyPnl, 0);
  assert.equal(next.state.halted, true);
  assert.match(next.reason!, /manual review/);
});

test('UTC rollover resets daily equity but never the pause', () => {
  const first = checkRisk(undefined, now, 1, 100, config).state;
  const result = checkRisk({ ...first, pauseUntil: now + 3600000 }, now + 600000, 1, 98, config);
  assert.equal(result.state.day, '2026-10-02');
  assert.equal(result.dailyPnl, 0);
  assert.match(result.reason!, /paused/);
});

test('toxic up or down move within window pauses for exactly PAUSE_MIN', () => {
  for (const mid of [1.021, 0.979]) {
    const first = checkRisk(undefined, now, 1, 100, config).state;
    const result = checkRisk(first, now + 60000, mid, 100, config);
    assert.equal(result.state.pauseUntil, now + 60000 + 30 * 60000);
    assert.match(result.reason!, /toxic/);
    assert.equal(checkRisk(result.state, result.state.pauseUntil, mid, 100, config).reason, undefined);
  }
});

test('toxic comparison includes all observations in window, not just last tick', () => {
  const first = checkRisk(undefined, now, 1, 100, config).state;
  const second = checkRisk(first, now + 60000, 1.015, 100, config).state;
  assert.match(checkRisk(second, now + 120000, 1.03, 100, config).reason!, /toxic/);
});

test('out-of-window moves are ignored and inputs are not mutated', () => {
  const first = checkRisk(undefined, now, 1, 100, config).state;
  const before = JSON.stringify(first);
  assert.equal(checkRisk(first, now + 600001, 1.03, 100, config).reason, undefined);
  assert.equal(JSON.stringify(first), before);
});

test('active pause is not extended on every poll; daily loss has precedence', () => {
  const first = checkRisk(undefined, now, 1, 100, config).state;
  const paused = checkRisk(first, now + 1, 1.03, 100, config).state;
  const next = checkRisk(paused, now + 2, 1.04, 94, config);
  assert.equal(next.state.pauseUntil, paused.pauseUntil);
  assert.match(next.reason!, /daily loss/);
});

test('invalid observations are explicit errors', () => {
  assert.throws(() => checkRisk(undefined, now, NaN, 100, config));
  assert.throws(() => checkRisk(undefined, now, 1, -1, config));
});
