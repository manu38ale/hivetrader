import { callHiveAPI, fetchOrderBook, parseFillOrderOperations } from './hiveApi';
import type { BotOpenOrder, BotSnapshot } from '../types/bot';
import type { FillOrderOperation } from '../types/hive';

type DataErrorCode = 'invalidResponse' | 'accountNotFound' | 'invalidBook' | 'historyLimit';
export class BotDataError extends Error {
  constructor(readonly code: DataErrorCode) { super(code); }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asset(value: unknown): { amount: number; symbol: 'HIVE' | 'HBD' } {
  const match = typeof value === 'string' ? /^(\d+\.\d{3}) (HIVE|HBD)$/.exec(value) : null;
  const amount = match ? Number(match[1]) : NaN;
  if (!match || !Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER / 1000) {
    throw new BotDataError('invalidResponse');
  }
  return { amount, symbol: match[2] as 'HIVE' | 'HBD' };
}

function utc(value: unknown): string {
  if (typeof value !== 'string') throw new BotDataError('invalidResponse');
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`);
  if (!Number.isFinite(date.getTime())) throw new BotDataError('invalidResponse');
  return date.toISOString();
}

async function read(method: string, params: unknown[], signal: AbortSignal): Promise<unknown> {
  return callHiveAPI(method, params, AbortSignal.any([signal, AbortSignal.timeout(20000)]));
}

export function parseBotOrders(raw: unknown): BotOpenOrder[] {
  if (!Array.isArray(raw)) throw new BotDataError('invalidResponse');
  const ids = new Set<number>();
  return raw.map((value: unknown) => {
    if (!record(value) || !record(value.sell_price) || typeof value.orderid !== 'number'
      || !Number.isInteger(value.orderid) || value.orderid < 0 || value.orderid > 0xffffffff
      || typeof value.for_sale !== 'number' || !Number.isFinite(value.for_sale) || value.for_sale <= 0
      || ids.has(value.orderid)) throw new BotDataError('invalidResponse');
    ids.add(value.orderid);
    const base = asset(value.sell_price.base);
    const quote = asset(value.sell_price.quote);
    if (base.symbol === quote.symbol || base.amount <= 0 || quote.amount <= 0) {
      throw new BotDataError('invalidResponse');
    }
    const side = base.symbol === 'HBD' ? 'buy' : 'sell';
    const price = side === 'buy' ? base.amount / quote.amount : quote.amount / base.amount;
    const sell = value.for_sale / 1000;
    return {
      id: value.orderid, side, price,
      remainingHive: side === 'sell' ? sell : sell / price,
      remainingHbd: side === 'buy' ? sell : sell * price,
      createdAt: utc(value.created), expiresAt: utc(value.expiration),
    };
  });
}

export async function fetchBotSnapshot(account: string, signal: AbortSignal): Promise<BotSnapshot> {
  const [accounts, rawOrders, book] = await Promise.all([
    read('condenser_api.get_accounts', [[account]], signal),
    read('condenser_api.get_open_orders', [account], signal),
    fetchOrderBook(AbortSignal.any([signal, AbortSignal.timeout(20000)])),
  ]);
  if (!Array.isArray(accounts)) throw new BotDataError('invalidResponse');
  const found: unknown = accounts[0];
  if (!found) throw new BotDataError('accountNotFound');
  if (!record(found) || found.name !== account) throw new BotDataError('invalidResponse');
  const hive = asset(found.balance);
  const hbd = asset(found.hbd_balance);
  if (hive.symbol !== 'HIVE' || hbd.symbol !== 'HBD') throw new BotDataError('invalidResponse');
  const bid = book.bids[0]?.price;
  const ask = book.asks[0]?.price;
  if (!bid || !ask || ask <= bid) throw new BotDataError('invalidBook');
  const orders = parseBotOrders(rawOrders);
  return {
    freeHive: hive.amount, freeHbd: hbd.amount,
    reservedHive: orders.reduce((sum, order) => sum + (order.side === 'sell' ? order.remainingHive : 0), 0),
    reservedHbd: orders.reduce((sum, order) => sum + (order.side === 'buy' ? order.remainingHbd : 0), 0),
    orders, mid: (bid + ask) / 2, updatedAt: Date.now(),
  };
}

export async function fetchBotOperations(
  account: string, since: number | undefined, signal: AbortSignal,
): Promise<FillOrderOperation[]> {
  const fills: [number, { timestamp: string; op: [string, Record<string, unknown>] }][] = [];
  let start = -1;
  let entries = 0;
  while (!signal.aborted) {
    const limit = start === -1 ? 1000 : Math.min(1000, start + 1);
    const page = await read('condenser_api.get_account_history', [account, start, limit], signal);
    if (!Array.isArray(page)) throw new BotDataError('invalidResponse');
    if (!page.length) {
      if (start !== -1) throw new BotDataError('invalidResponse');
      break;
    }
    entries += page.length;
    if (entries > 100000) throw new BotDataError('historyLimit');
    let oldestId = Infinity;
    let oldestTime = Infinity;
    const ids = new Set<number>();
    for (const entry of page as unknown[]) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'number'
        || !Number.isSafeInteger(entry[0]) || entry[0] < 0 || ids.has(entry[0])
        || (start !== -1 && entry[0] > start) || !record(entry[1])) {
        throw new BotDataError('invalidResponse');
      }
      const [id, transaction] = entry;
      const op: unknown = transaction.op;
      if (!Array.isArray(op) || typeof op[0] !== 'string') throw new BotDataError('invalidResponse');
      ids.add(id);
      const timestamp = utc(transaction.timestamp);
      oldestId = Math.min(oldestId, id);
      oldestTime = Math.min(oldestTime, Date.parse(timestamp));
      if (op[0] !== 'fill_order' || (since !== undefined && Date.parse(timestamp) < since)) continue;
      const payload: unknown = op[1];
      if (!record(payload) || typeof payload.current_owner !== 'string' || typeof payload.open_owner !== 'string'
        || (payload.current_owner !== account && payload.open_owner !== account)) {
        throw new BotDataError('invalidResponse');
      }
      const current = asset(payload.current_pays);
      const open = asset(payload.open_pays);
      if (current.symbol === open.symbol || current.amount <= 0 || open.amount <= 0) {
        throw new BotDataError('invalidResponse');
      }
      fills.push([id, { timestamp, op: ['fill_order', payload] }]);
    }
    if (oldestId === 0 || (since !== undefined && oldestTime < since)) break;
    start = oldestId - 1;
  }
  signal.throwIfAborted();
  return parseFillOrderOperations(fills, account).operations;
}
