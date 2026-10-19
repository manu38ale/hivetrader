import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { isSpreadSample, type SpreadSample } from './spreadHistory.js';

export interface SpreadDay {
  day: string;
  observedSeconds: number;
  timeAboveThresholdPct: number;
  averageSpreadPct: number;
  maxSpreadPct: number;
}

interface Accumulator { duration: number; above: number; weighted: number; max: number }

export async function summarizeSpreads(
  samples: AsyncIterable<SpreadSample> | Iterable<SpreadSample>,
  threshold: number, pollIntervalSec: number, now = Date.now(),
): Promise<SpreadDay[]> {
  if (!Number.isFinite(threshold) || threshold < 0 || !Number.isFinite(pollIntervalSec)
    || pollIntervalSec <= 0 || !Number.isFinite(now)) throw new Error('Invalid spread report settings');
  const days = new Map<string, Accumulator>();
  const pollMs = pollIntervalSec * 1000;
  function add(sample: SpreadSample, until: number): void {
    let from = Date.parse(sample.time);
    while (from < until) {
      const day = new Date(from).toISOString().slice(0, 10);
      const midnight = Date.parse(`${day}T00:00:00Z`) + 86400000;
      const end = Math.min(until, midnight);
      const duration = (end - from) / 1000;
      const entry = days.get(day) ?? { duration: 0, above: 0, weighted: 0, max: 0 };
      entry.duration += duration;
      entry.above += sample.spreadPct > threshold ? duration : 0;
      entry.weighted += sample.spreadPct * duration;
      entry.max = Math.max(entry.max, sample.spreadPct);
      days.set(day, entry);
      from = end;
    }
  }
  let previous: SpreadSample | undefined;
  for await (const sample of samples) {
    if (!isSpreadSample(sample)) throw new Error('Invalid spread history sample');
    const time = Date.parse(sample.time);
    if (time > now) throw new Error('Spread history contains a future timestamp; check UTC clock');
    if (previous) {
      const lastTime = Date.parse(previous.time);
      if (time <= lastTime) throw new Error('Spread history timestamps must be strictly increasing');
      const gap = time - lastTime;
      // Do not infer market conditions throughout an outage.
      add(previous, gap <= 2 * pollMs ? time : lastTime + pollMs);
    }
    previous = sample;
  }
  if (previous) add(previous, Math.min(now, Date.parse(previous.time) + pollMs));
  if (!days.size) throw new Error('No observed spread duration to report');
  return [...days.entries()].map(([day, entry]) => ({
    day, observedSeconds: entry.duration,
    timeAboveThresholdPct: entry.above / entry.duration * 100,
    averageSpreadPct: entry.weighted / entry.duration, maxSpreadPct: entry.max,
  }));
}

export async function* readSpreadHistory(path: string): AsyncGenerator<SpreadSample> {
  let found = false;
  for (const file of [`${path}.old`, path]) {
    const info = await stat(file).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!info) continue;
    found = true;
    const input = createReadStream(file, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    let lineNumber = 0;
    try {
      for await (const line of lines) {
        lineNumber++;
        let sample: unknown;
        try { sample = JSON.parse(line); }
        catch { throw new Error(`Invalid JSON in ${file}:${lineNumber}`); }
        if (!isSpreadSample(sample)) throw new Error(`Invalid spread sample in ${file}:${lineNumber}`);
        yield sample;
      }
    } finally {
      lines.close();
      input.destroy();
    }
  }
  if (!found) throw new Error(`No spread history found at ${path}; run paper first`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const path = join(config.stateDir, 'spread-history.jsonl');
  const days = await summarizeSpreads(readSpreadHistory(path), config.minSpreadPct, config.pollIntervalSec);
  console.log(`UTC spread report | threshold > ${(config.minSpreadPct * 100).toFixed(4)}% | poll ${config.pollIntervalSec}s`);
  console.table(days.map(day => ({
    day: day.day,
    observedHours: (day.observedSeconds / 3600).toFixed(4),
    timeAboveThreshold: `${day.timeAboveThresholdPct.toFixed(2)}%`,
    averageSpread: `${(day.averageSpreadPct * 100).toFixed(4)}%`,
    maximumSpread: `${(day.maxSpreadPct * 100).toFixed(4)}%`,
  })));
  console.log('Time-weighted observed coverage only; gaps > 2 polls are not extrapolated beyond one poll. Last sample covers at most one poll. Spread availability is not profit.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Spread report failed');
    process.exitCode = 1;
  });
}
