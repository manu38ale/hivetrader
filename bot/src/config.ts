export interface Config {
  account: string;
  paper: boolean;
  nodes: string[];
  pollIntervalSec: number;
  quoteSizePct: number;
  minSpreadPct: number;
  requoteThresholdPct: number;
  inventoryTargetHbdPct: number;
  skewGain: number;
  orderExpirationMin: number;
  toxicMovePct: number;
  toxicWindowMin: number;
  pauseMin: number;
  maxDailyLossHbd: number;
  priceTick: number;
  stateDir: string;
}

export function numberEnv(
  env: NodeJS.ProcessEnv, name: string, fallback: number, min = 0, max = Infinity,
): number {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (raw?.trim() === '' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}: expected a number in [${min}, ${max}]`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env.PAPER_MODE !== undefined && !['true', 'false'].includes(env.PAPER_MODE)) {
    throw new Error('PAPER_MODE must be exactly true or false');
  }
  const nodes = (env.RPC_NODES ?? 'https://api.hive.blog,https://api.deathwing.me,https://api.openhive.network')
    .split(',').map(node => node.trim());
  if (!nodes.length || nodes.some(node => new URL(node).protocol !== 'https:')) {
    throw new Error('RPC_NODES must contain HTTPS URLs');
  }
  return {
    account: env.BOT_ACCOUNT?.trim() ?? '',
    paper: env.PAPER_MODE !== 'false',
    nodes,
    pollIntervalSec: numberEnv(env, 'POLL_INTERVAL_SEC', 15, 1),
    quoteSizePct: numberEnv(env, 'QUOTE_SIZE_PCT', 0.05, 0.001, 1),
    minSpreadPct: numberEnv(env, 'MIN_SPREAD_PCT', 0.01, 0, 1),
    requoteThresholdPct: numberEnv(env, 'REQUOTE_THRESHOLD_PCT', 0.002, 0, 1),
    inventoryTargetHbdPct: numberEnv(env, 'INVENTORY_TARGET_HBD_PCT', 0.5, 0, 1),
    skewGain: numberEnv(env, 'SKEW_GAIN', 1, 0),
    orderExpirationMin: numberEnv(env, 'ORDER_EXPIRATION_MIN', 60, 1, 40320),
    toxicMovePct: numberEnv(env, 'TOXIC_MOVE_PCT', 0.02, 0),
    toxicWindowMin: numberEnv(env, 'TOXIC_WINDOW_MIN', 10, 0.01),
    pauseMin: numberEnv(env, 'PAUSE_MIN', 30, 0.01),
    maxDailyLossHbd: numberEnv(env, 'MAX_DAILY_LOSS_HBD', 5, 0),
    priceTick: numberEnv(env, 'PRICE_TICK', 0.000001, Number.EPSILON),
    stateDir: env.STATE_DIR ?? '.state',
  };
}
