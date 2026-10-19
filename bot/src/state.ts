import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config.js';
import type { PersistentState } from './types.js';

function validState(value: unknown): value is PersistentState {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<PersistentState>;
  if (s.version !== 1 || typeof s.account !== 'string' || typeof s.paper !== 'boolean'
    || !Number.isInteger(s.lastOrderId) || s.lastOrderId! < 0 || s.lastOrderId! > 0xffffffff
    || !s.anchors || typeof s.anchors !== 'object') return false;
  if (!Object.values(s.anchors).every(anchor => typeof anchor === 'object' && anchor !== null
    && Number.isFinite(anchor.mid) && anchor.mid > 0)) return false;
  const r = s.risk;
  return r === undefined || (typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day)
    && Number.isFinite(r.openingEquity) && r.openingEquity >= 0
    && typeof r.halted === 'boolean' && Number.isFinite(r.pauseUntil)
    && Array.isArray(r.samples) && r.samples.every(sample => Number.isFinite(sample.time)
      && Number.isFinite(sample.mid) && sample.mid > 0));
}

export async function openState(config: Config) {
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  const path = join(config.stateDir, `${config.account}-${config.paper ? 'paper' : 'live'}.json`);
  const lockPath = `${path}.lock`;
  const lock = await open(lockPath, 'wx', 0o600).catch(() => {
    throw new Error(`Cannot acquire ${lockPath}; stop duplicate process or review stale lock`);
  });
  const release = async () => { await lock.close(); await rm(lockPath); };
  try {
    await lock.writeFile(String(process.pid));
    let state: PersistentState;
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!validState(value) || value.account !== config.account || value.paper !== config.paper) {
        throw new Error('Invalid persistent state; review manually, do not reset blindly');
      }
      state = value;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      state = { version: 1, account: config.account, paper: config.paper, lastOrderId: 0, anchors: {} };
    }
    const save = async () => {
      const tmp = `${path}.tmp`;
      await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
      await rename(tmp, path);
    };
    return { state, save, release };
  } catch (error) {
    await release();
    throw error;
  }
}
