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
