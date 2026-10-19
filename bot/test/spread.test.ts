import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { appendSpreadSample, MAX_SPREAD_HISTORY_BYTES, type SpreadSample } from '../src/spreadHistory.js';
import { readSpreadHistory, summarizeSpreads } from '../src/spreadReport.js';
import { decide } from '../src/strategy.js';
import { loadConfig } from '../src/config.js';

const start = Date.parse('2026-10-01T12:00:00Z');
const sample = (seconds: number, spreadPct: number): SpreadSample => ({
  time: new Date(start + seconds * 1000).toISOString(), mid: 0.05, spreadPct,
});

test('spread report is duration weighted rather than a percentage of samples', async () => {
  const report = await summarizeSpreads([sample(0, 0.02), sample(1, 0.005)], 0.01, 15, start + 16000);
  assert.equal(report[0]!.observedSeconds, 16);
  assert.equal(report[0]!.timeAboveThresholdPct, 6.25);
  assert.equal(report[0]!.averageSpreadPct, (0.02 + 0.005 * 15) / 16);
  assert.equal(report[0]!.maxSpreadPct, 0.02);
});

test('spread report splits observed durations correctly across UTC midnight', async () => {
  const midnight = Date.parse('2026-10-02T00:00:00Z');
  const report = await summarizeSpreads([
    { ...sample(0, 0.02), time: new Date(midnight - 10000).toISOString() },
    { ...sample(0, 0.005), time: new Date(midnight + 10000).toISOString() },
    { ...sample(0, 0.03), time: new Date(midnight + 30000).toISOString() },
  ], 0.01, 15, midnight + 45000);
  assert.equal(report[0]!.day, '2026-10-01');
  assert.equal(report[0]!.observedSeconds, 10);
  assert.equal(report[0]!.timeAboveThresholdPct, 100);
  assert.equal(report[1]!.day, '2026-10-02');
  assert.equal(report[1]!.observedSeconds, 45);
  assert.ok(Math.abs(report[1]!.timeAboveThresholdPct - 25 / 45 * 100) < 1e-9);
  assert.ok(Math.abs(report[1]!.averageSpreadPct - 0.75 / 45) < 1e-9);
  assert.equal(report[1]!.maxSpreadPct, 0.03);
});

test('missing hours are not treated as evidence that the last spread persisted', async () => {
  const report = await summarizeSpreads([sample(0, 0.02), sample(3600, 0.005)], 0.01, 15, start + 3615000);
  assert.equal(report[0]!.observedSeconds, 30);
  assert.equal(report[0]!.timeAboveThresholdPct, 50);
});

test('threshold comparison is strictly greater, not greater-or-equal', async () => {
  const report = await summarizeSpreads([sample(0, 0.01)], 0.01, 15, start + 15000);
  assert.equal(report[0]!.timeAboveThresholdPct, 0);
});

test('JSONL rotation keeps one old file and starts the current file with a complete sample', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'hive-spread-rotation-'));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'spread-history.jsonl');
  const large = JSON.stringify({ ...sample(0, 0.01), padding: 'x'.repeat(MAX_SPREAD_HISTORY_BYTES) }) + '\n';
  await writeFile(path, large);
  await appendSpreadSample(dir, sample(15, 0.02));
  assert.equal(await readFile(`${path}.old`, 'utf8'), large);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), sample(15, 0.02));
  await writeFile(path, large);
  await appendSpreadSample(dir, sample(30, 0.03));
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), sample(30, 0.03));
  assert.equal(await readFile(`${path}.old`, 'utf8'), large);
});

test('report consumes rotated and active files and rejects malformed lines explicitly', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'hive-spread-read-'));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'spread-history.jsonl');
  await writeFile(`${path}.old`, `${JSON.stringify(sample(0, 0.02))}\n`);
  await writeFile(path, `${JSON.stringify(sample(15, 0.005))}\n`);
  const report = await summarizeSpreads(readSpreadHistory(path), 0.01, 15, start + 30000);
  assert.equal(report[0]!.observedSeconds, 30);
  assert.equal(report[0]!.timeAboveThresholdPct, 50);
  await writeFile(path, 'not-json\n');
  await assert.rejects(summarizeSpreads(readSpreadHistory(path), 0.01, 15, start + 30000), /Invalid JSON.*:1/);
});

test('one simulated paper hour produces coherent JSONL metrics without any broadcasts', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'hive-spread-hour-'));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const config = loadConfig({});
  for (let i = 0; i < 240; i++) {
    const spreadPct = i < 120 ? 0.005 : 0.02;
    const book = { bestBid: 0.05 * (1 - spreadPct / 2), bestAsk: 0.05 * (1 + spreadPct / 2), mid: 0.05, spreadPct };
    const decision = decide(book, { hive: 1000, hbd: 50 }, [], {}, start + i * 15000, config);
    assert.equal(decision.create.length, i < 120 ? 0 : 2);
    await appendSpreadSample(dir, sample(i * 15, spreadPct));
  }
  const report = await summarizeSpreads(readSpreadHistory(join(dir, 'spread-history.jsonl')), 0.01, 15, start + 3600000);
  assert.equal(report[0]!.observedSeconds, 3600);
  assert.equal(report[0]!.timeAboveThresholdPct, 50);
  assert.ok(Math.abs(report[0]!.averageSpreadPct - 0.0125) < 1e-10);
  assert.equal(report[0]!.maxSpreadPct, 0.02);
});

test('missing, invalid or non-monotonic history fails instead of inventing metrics', async context => {
  const dir = await mkdtemp(join(tmpdir(), 'hive-spread-invalid-'));
  context.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(summarizeSpreads(readSpreadHistory(join(dir, 'missing.jsonl')), 0.01, 15), /No spread history/);
  await assert.rejects(summarizeSpreads([sample(0, 0.01), sample(0, 0.02)], 0.01, 15, start + 15000), /strictly increasing/);
  await assert.rejects(appendSpreadSample(dir, { ...sample(0, 0.01), mid: NaN }), /Invalid spread sample/);
});
