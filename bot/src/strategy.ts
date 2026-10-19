import type { Config } from './config.js';
import type { Balances, Book, Decision, OpenOrder, Quote, QuoteAnchor, Side } from './types.js';

export function asset(amount: number, symbol: 'HIVE' | 'HBD'): string {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid asset amount');
  return `${(Math.floor(amount * 1000 + 1e-9) / 1000).toFixed(3)} ${symbol}`;
}

export function totalBalances(free: Balances, orders: OpenOrder[]): Balances {
  return orders.reduce((total, order) => ({
    hive: total.hive + (order.side === 'ask' ? order.sell : 0),
    hbd: total.hbd + (order.side === 'bid' ? order.sell : 0),
  }), { ...free });
}

export function equity(balances: Balances, mid: number): number {
  return balances.hbd + balances.hive * mid;
}

export function makeQuote(side: Side, price: number, sell: number): Quote | undefined {
  sell = Math.floor(sell * 1000 + 1e-9) / 1000;
  if (!(price > 0) || !Number.isFinite(price) || sell < 0.001) return undefined;
  // Round receive upwards: rounding must never worsen the maker's limit price.
  const receive = Math.ceil((side === 'bid' ? sell / price : sell * price) * 1000) / 1000;
  if (!Number.isFinite(receive) || receive < 0.001) return undefined;
  return {
    side, price: side === 'bid' ? sell / receive : receive / sell,
    amountToSell: asset(sell, side === 'bid' ? 'HBD' : 'HIVE'),
    minToReceive: asset(receive, side === 'bid' ? 'HIVE' : 'HBD'),
  };
}

export function decide(
  book: Book, free: Balances, orders: OpenOrder[], anchors: Record<string, QuoteAnchor>,
  now: number, config: Config, pausedReason?: string,
): Decision {
  const total = totalBalances(free, orders);
  const value = equity(total, book.mid);
  const ratio = value > 0 ? total.hbd / value : config.inventoryTargetHbdPct;
  const skew = (ratio - config.inventoryTargetHbdPct) * config.skewGain;
  const base = { spreadPct: book.spreadPct, skew };
  const stop = (reason: string): Decision => ({
    ...base, cancel: orders.map(order => order.id), create: [], reason,
  });
  if (pausedReason) return stop(pausedReason);
  if (![book.mid, book.bestBid, book.bestAsk, book.spreadPct, free.hive, free.hbd]
    .every(Number.isFinite) || book.bestBid <= 0 || book.bestAsk <= book.bestBid
    || free.hive < 0 || free.hbd < 0) return stop('invalid market or balances');
  if (book.spreadPct < config.minSpreadPct) return stop('spread below minimum');
  const improve = book.bestAsk - book.bestBid > 2 * config.priceTick;
  const bid = (book.bestBid + (improve ? config.priceTick : 0)) * (1 - skew);
  const ask = (book.bestAsk - (improve ? config.priceTick : 0)) * (1 - skew);
  if (!(bid > 0 && ask > bid) || bid >= book.bestAsk || ask <= book.bestBid) {
    return stop('inventory skew would cross the book; maker-only guard');
  }
  const decision: Decision = { ...base, cancel: [], create: [], reason: '' };
  const reasons: string[] = [];
  for (const side of ['bid', 'ask'] as const) {
    const existing = orders.filter(order => order.side === side);
    const order = existing[0];
    const anchor = order && anchors[order.id];
    const expired = order && (now - order.created >= config.orderExpirationMin * 60000
      || now >= order.expires);
    const moved = anchor && Math.abs(book.mid / anchor.mid - 1) > config.requoteThresholdPct;
    if (existing.length === 1 && anchor && !expired && !moved) {
      reasons.push(`${side}: hold (mid within threshold, order unexpired)`);
      continue;
    }
    decision.cancel.push(...existing.map(item => item.id));
    const amount = (side === 'bid' ? total.hbd : total.hive) * config.quoteSizePct;
    const quote = makeQuote(side, side === 'bid' ? bid : ask, amount);
    if (quote) decision.create.push(quote);
    reasons.push(`${side}: ${quote ? 'quote' : 'insufficient balance'} (${!order ? 'missing'
      : existing.length > 1 ? 'duplicate orders' : !anchor ? 'untracked order'
      : expired ? 'expired' : 'mid moved'})`);
  }
  decision.reason = reasons.join('; ');
  return decision;
}
