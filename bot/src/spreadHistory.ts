import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_SPREAD_HISTORY_BYTES = 5 * 1024 * 1024;

export interface SpreadSample {
  time: string;
  mid: number;
  spreadPct: number;
}

export function isSpreadSample(value: unknown): value is SpreadSample {
  if (typeof value !== 'object' || value === null) return false;
  const sample = value as Partial<SpreadSample>;
  return typeof sample.time === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(sample.time)
    && Number.isFinite(Date.parse(sample.time))
    && typeof sample.mid === 'number' && Number.isFinite(sample.mid) && sample.mid > 0
    && typeof sample.spreadPct === 'number' && Number.isFinite(sample.spreadPct) && sample.spreadPct >= 0;
}

export async function appendSpreadSample(stateDir: string, sample: SpreadSample): Promise<void> {
  if (!isSpreadSample(sample)) throw new Error('Invalid spread sample');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const path = join(stateDir, 'spread-history.jsonl');
  const line = `${JSON.stringify(sample)}\n`;
  const info = await stat(path).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (info && info.size + Buffer.byteLength(line) > MAX_SPREAD_HISTORY_BYTES) {
    await rename(path, `${path}.old`);
  }
  await appendFile(path, line, { mode: 0o600 });
}
