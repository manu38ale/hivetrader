import type { Config } from './config.js';
import type { RiskState } from './types.js';

export function checkRisk(
  previous: RiskState | undefined, now: number, mid: number, currentEquity: number, config: Config,
): { state: RiskState; reason?: string; dailyPnl: number } {
  if (![now, mid, currentEquity].every(Number.isFinite) || mid <= 0 || currentEquity < 0) {
    throw new Error('Invalid risk observation');
  }
  const day = new Date(now).toISOString().slice(0, 10);
  const state: RiskState = previous
    ? { ...previous, samples: [...previous.samples] }
    : { day, openingEquity: currentEquity, halted: false, pauseUntil: 0, samples: [] };
  if (state.day !== day) {
    state.day = day;
    state.openingEquity = currentEquity;
    // A daily rollover never clears a manual-review latch.
  }
  const dailyPnl = currentEquity - state.openingEquity;
  if (-dailyPnl > config.maxDailyLossHbd) state.halted = true;
  state.samples = state.samples.filter(sample =>
    sample.time >= now - config.toxicWindowMin * 60000 && sample.time <= now);
  const toxic = state.samples.some(sample => Math.abs(mid / sample.mid - 1) > config.toxicMovePct);
  if (toxic && now >= state.pauseUntil) {
    state.pauseUntil = now + config.pauseMin * 60000;
  }
  state.samples.push({ time: now, mid });
  return {
    state, dailyPnl,
    reason: state.halted ? 'daily loss breaker: manual review required'
      : now < state.pauseUntil ? `toxic move breaker: paused until ${new Date(state.pauseUntil).toISOString()}`
      : undefined,
  };
}
