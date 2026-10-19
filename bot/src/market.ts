import { Client } from '@hiveio/dhive';
import type { Balances, Book, OpenOrder } from './types.js';

export class Rpc {
  private index = 0;
  constructor(readonly nodes: string[]) {}

  client(): Client {
    return new Client(this.nodes[this.index]!, { timeout: 10000, backoff: () => 500, consoleOnFailover: false });
  }

  async read<T>(api: string, method: string, params: unknown): Promise<T> {
    for (let attempt = 0; attempt < this.nodes.length; attempt++) {
      try {
        return await this.client().call(api, method, params);
      } catch {
        console.error(JSON.stringify({ event: 'rpc_read_failed', node: this.nodes[this.index], method }));
        this.rotate();
      }
    }
    throw new Error(`All RPC nodes failed for ${api}.${method}`);
  }

  rotate(): void { this.index = (this.index + 1) % this.nodes.length; }
}

interface ChainPrice { base: string; quote: string }
interface BookEntry { real_price: string }
interface ChainOrder {
  orderid: number;
  for_sale: number;
  sell_price: ChainPrice;
  created: string;
  expiration: string;
}
export function parseAsset(value: string): { amount: number; symbol: 'HIVE' | 'HBD' } {
  const match = /^(\d+\.\d{3}) (HIVE|HBD)$/.exec(value);
  if (!match) throw new Error('Unexpected HIVE/HBD asset');
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) throw new Error('Invalid asset amount');
  return { amount, symbol: match[2] as 'HIVE' | 'HBD' };
}
export function utcTime(value: string): number {
  const time = Date.parse(value.endsWith('Z') ? value : `${value}Z`);
  if (!Number.isFinite(time)) throw new Error('Invalid chain timestamp');
  return time;
}
export async function readBook(rpc: Rpc): Promise<Book> {
  const book = await rpc.read<{ bids: BookEntry[]; asks: BookEntry[] }>(
    'condenser_api', 'get_order_book', [50],
  );
  const bestBid = Number(book.bids[0]?.real_price);
  const bestAsk = Number(book.asks[0]?.real_price);
  if (!(bestBid > 0 && bestAsk > bestBid) || !Number.isFinite(bestAsk)) {
    throw new Error('Empty, invalid or crossed order book');
  }
  const mid = (bestBid + bestAsk) / 2;
  return { bestBid, bestAsk, mid, spreadPct: (bestAsk - bestBid) / mid };
}
export async function readOrders(rpc: Rpc, account: string): Promise<OpenOrder[]> {
  const orders = await rpc.read<ChainOrder[]>('condenser_api', 'get_open_orders', [account]);
  return orders.map(order => {
    const base = parseAsset(order.sell_price.base);
    const quote = parseAsset(order.sell_price.quote);
    if (base.symbol === quote.symbol || base.amount <= 0 || quote.amount <= 0
      || !Number.isInteger(order.orderid) || order.orderid < 0 || order.orderid > 0xffffffff
      || !Number.isFinite(order.for_sale) || order.for_sale <= 0) {
      throw new Error('Invalid open order');
    }
    return {
      id: order.orderid, side: base.symbol === 'HBD' ? 'bid' : 'ask',
      sell: order.for_sale / 1000,
      price: base.symbol === 'HBD' ? base.amount / quote.amount : quote.amount / base.amount,
      created: utcTime(order.created), expires: utcTime(order.expiration),
    };
  });
}
export async function readBalances(rpc: Rpc, account: string): Promise<Balances> {
  const accounts = await rpc.read<{ balance: string; hbd_balance: string }[]>(
    'condenser_api', 'get_accounts', [[account]],
  );
  const found = accounts[0];
  if (!found) throw new Error('BOT_ACCOUNT not found');
  return { hive: parseAsset(found.balance).amount, hbd: parseAsset(found.hbd_balance).amount };
}

export interface RcBalance { current: bigint; max: bigint }
export type MarketOperation = 'limit_order_create' | 'limit_order_cancel';

function rcInteger(value: unknown): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error('Invalid RC integer; expected a safe integer or decimal string');
}

export async function readRc(rpc: Rpc, account: string, now = Date.now()): Promise<RcBalance> {
  const result = await rpc.read<{
    rc_accounts: { account: string; rc_manabar: { current_mana: unknown; last_update_time: unknown }; max_rc: unknown }[];
  }>('rc_api', 'find_rc_accounts', { accounts: [account] });
  const found = result.rc_accounts[0];
  if (!found || found.account !== account || !Number.isFinite(now) || now < 0) {
    throw new Error('RC account unavailable or invalid observation time');
  }
  const max = rcInteger(found.max_rc);
  const mana = rcInteger(found.rc_manabar.current_mana);
  const lastUpdate = rcInteger(found.rc_manabar.last_update_time);
  if (max < 0n || lastUpdate < 0n) throw new Error('Invalid RC manabar');
  const seconds = BigInt(Math.floor(now / 1000));
  const elapsed = seconds > lastUpdate ? seconds - lastUpdate : 0n;
  // Hive regenerates the RC manabar over five days; API mana is stored at last_update_time.
  const regenerated = mana + max * elapsed / 432000n;
  return { current: regenerated < 0n ? 0n : regenerated > max ? max : regenerated, max };
}

export async function estimateRcCost(rpc: Rpc, operations: MarketOperation[]): Promise<bigint> {
  if (!operations.length) throw new Error('Cannot estimate an empty transaction');
  const costs = new Map<MarketOperation, bigint>();
  await Promise.all([...new Set(operations)].map(async operation => {
    const stats = await rpc.read<{ count: unknown; avg_cost_rc: unknown }>(
      'rc_api', 'get_rc_operation_stats', { operation: `${operation}_operation` },
    );
    const cost = rcInteger(stats.avg_cost_rc);
    if (rcInteger(stats.count) <= 0n || cost <= 0n) throw new Error('RC operation cost statistics unavailable');
    costs.set(operation, cost);
  }));
  // Dynamic per-operation averages with 2x headroom, including all operations in a requote.
  return operations.reduce((sum, operation) => sum + costs.get(operation)!, 0n) * 2n;
}
