import { pathToFileURL } from 'node:url';
import { loadConfig, numberEnv, type Config } from './config.js';
import { Rpc, utcTime } from './market.js';
import { checkRisk } from './risk.js';
import { decide, equity, totalBalances } from './strategy.js';
import type { Balances, Book, OpenOrder, QuoteAnchor, RiskState, Side } from './types.js';

interface NaiAsset { amount: string; precision: number; nai: string }
interface ChainTrade { date: string; current_pays: NaiAsset; open_pays: NaiAsset }
export interface Trade { time: number; price: number; hive: number; takerSellsHive: boolean }

function tradeAsset(asset: NaiAsset): { amount: number; symbol: 'HIVE' | 'HBD' } {
  const symbol = asset.nai === '@@000000021' ? 'HIVE'
    : asset.nai === '@@000000013' ? 'HBD' : undefined;
  const amount = Number(asset.amount) / 10 ** asset.precision;
  if (!symbol || asset.precision !== 3 || !(amount > 0) || !Number.isFinite(amount)) {
    throw new Error('Invalid market history asset');
  }
  return { amount, symbol };
}

export async function fetchTrades(rpc: Rpc, start: number, end: number): Promise<Trade[]> {
  if (start % 1000 || end % 1000 || start >= end) throw new Error('Invalid historical interval');
  const trades: Trade[] = [];
  async function window(from: number, until: number): Promise<void> {
    const result = await rpc.read<{ trades: ChainTrade[] }>('market_history_api', 'get_trade_history', {
      start: new Date(from).toISOString().slice(0, 19),
      end: new Date(until - 1000).toISOString().slice(0, 19), limit: 1000,
    });
    if (!Array.isArray(result.trades)) throw new Error('Invalid trade history response');
    if (result.trades.length >= 1000) {
      if (until - from <= 1000) throw new Error('History saturated within one second; cannot paginate losslessly');
      const split = from + Math.floor((until - from) / 2000) * 1000;
      await window(from, split);
      await window(split, until);
      return;
    }
    for (const row of result.trades) {
      const current = tradeAsset(row.current_pays);
      const open = tradeAsset(row.open_pays);
      if (current.symbol === open.symbol) throw new Error('History contains a non HIVE/HBD trade');
      const hive = current.symbol === 'HIVE' ? current.amount : open.amount;
      const hbd = current.symbol === 'HBD' ? current.amount : open.amount;
      const time = utcTime(row.date);
      if (time < from || time >= until) throw new Error('RPC returned trades outside requested interval');
      trades.push({ time, price: hbd / hive, hive, takerSellsHive: current.symbol === 'HIVE' });
    }
  }
  for (let from = start; from < end; from += 86400000) {
    const until = Math.min(from + 86400000, end);
    const before = trades.length;
    await window(from, until);
    if (trades.length === before) throw new Error(`No historical trades on ${new Date(from).toISOString()}; coverage incomplete`);
    console.error(JSON.stringify({ event: 'history_progress', day: new Date(from).toISOString(), trades: trades.length - before }));
  }
  return trades.sort((a, b) => a.time - b.time);
}

export function simulate(
  trades: Trade[], config: Config, initial: Balances, syntheticSpread: number, end: number,
) {
  const first = trades[0];
  if (!first || !(syntheticSpread > 0 && syntheticSpread < 1)) throw new Error('Invalid simulation inputs');
  const free = { ...initial };
  let orders: OpenOrder[] = [];
  const anchors: Record<string, QuoteAnchor> = {};
  let riskState: RiskState | undefined;
  let price = first.price;
  let nextPoll = first.time;
  let id = 0;
  let fills = 0;
  let peak = equity(initial, price);
  const initialEquity = peak;
  let maxDrawdown = 0;
  let matchedHive = 0;
  let matchedSpread = 0;
  let matchedSpreadPct = 0;
  const lots: { side: Side; hive: number; price: number }[] = [];
  const mark = () => {
    const value = equity(totalBalances(free, orders), price);
    peak = Math.max(peak, value);
    maxDrawdown = Math.max(maxDrawdown, peak - value);
    return value;
  };
  const cancel = (ids: number[]) => {
    for (const order of orders.filter(order => ids.includes(order.id))) {
      free[order.side === 'bid' ? 'hbd' : 'hive'] += order.sell;
      delete anchors[order.id];
    }
    orders = orders.filter(order => !ids.includes(order.id));
  };
  const poll = (time: number) => {
    cancel(orders.filter(order => order.expires <= time).map(order => order.id));
    const book: Book = {
      bestBid: price * (1 - syntheticSpread / 2), bestAsk: price * (1 + syntheticSpread / 2),
      mid: price, spreadPct: syntheticSpread,
    };
    const risk = checkRisk(riskState, time, price, mark(), config);
    riskState = risk.state;
    const decision = decide(book, free, orders, anchors, time, config, risk.reason);
    cancel(decision.cancel);
    for (const quote of decision.create) {
      const sell = Number(quote.amountToSell.split(' ')[0]);
      const symbol = quote.side === 'bid' ? 'hbd' : 'hive';
      if (sell > free[symbol] + 1e-9) throw new Error('Simulation overspend');
      free[symbol] -= sell;
      const order: OpenOrder = {
        id: ++id, side: quote.side, sell, price: quote.price, created: time,
        expires: time + config.orderExpirationMin * 60000,
      };
      orders.push(order);
      anchors[id] = { mid: price };
    }
  };
  for (const trade of trades) {
    // No quote can use the price of a future trade; same-second trades execute first.
    while (nextPoll < trade.time) {
      poll(nextPoll);
      nextPoll += config.pollIntervalSec * 1000;
    }
    cancel(orders.filter(order => order.expires <= trade.time).map(order => order.id));
    let volume = trade.hive;
    for (const order of [...orders]) {
      const eligible = order.side === 'bid'
        ? trade.takerSellsHive && trade.price <= order.price
        : !trade.takerSellsHive && trade.price >= order.price;
      if (!eligible || volume <= 0) continue;
      const hive = Math.floor(Math.min(volume, order.side === 'bid' ? order.sell / order.price : order.sell) * 1000) / 1000;
      const hbd = (order.side === 'ask' ? Math.ceil : Math.floor)(hive * order.price * 1000) / 1000;
      if (hive <= 0 || hbd <= 0) continue;
      order.sell -= order.side === 'bid' ? hbd : hive;
      free[order.side === 'bid' ? 'hive' : 'hbd'] += order.side === 'bid' ? hive : hbd;
      volume -= hive;
      fills++;
      let remaining = hive;
      while (remaining > 1e-9 && lots[0] && lots[0].side !== order.side) {
        const lot = lots[0];
        const paired = Math.min(remaining, lot.hive);
        const buy = order.side === 'bid' ? order.price : lot.price;
        const sell = order.side === 'ask' ? order.price : lot.price;
        matchedHive += paired;
        matchedSpread += (sell - buy) * paired;
        matchedSpreadPct += (sell / buy - 1) * paired;
        remaining -= paired;
        lot.hive -= paired;
        if (lot.hive <= 1e-9) lots.shift();
      }
      if (remaining > 1e-9) lots.push({ side: order.side, hive: remaining, price: order.price });
    }
    cancel(orders.filter(order => order.sell < 0.001).map(order => order.id));
    price = trade.price;
    mark();
  }
  while (nextPoll < end) {
    poll(nextPoll);
    nextPoll += config.pollIntervalSec * 1000;
  }
  const finalInventory = totalBalances(free, orders);
  return {
    model: 'synthetic-book trade replay; no historical queue/depth; not a profit forecast',
    syntheticSpreadPct: syntheticSpread,
    start: new Date(first.time).toISOString(), end: new Date(end).toISOString(),
    tradeCount: trades.length, pnlHbd: equity(finalInventory, price) - initialEquity,
    fills, averageCapturedSpreadHbdPerHive: matchedHive ? matchedSpread / matchedHive : null,
    averageCapturedSpreadPct: matchedHive ? matchedSpreadPct / matchedHive : null,
    matchedRoundTripHive: matchedHive, maxDrawdownHbd: maxDrawdown,
    finalInventory, finalEquityHbd: equity(finalInventory, price),
    manuallyHalted: riskState?.halted ?? false,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const days = numberEnv(process.env, 'BACKTEST_DAYS', 30, 1, 365);
  if (!Number.isInteger(days)) throw new Error('BACKTEST_DAYS must be an integer');
  const end = process.env.BACKTEST_END ? utcTime(process.env.BACKTEST_END) : Math.floor(Date.now() / 1000) * 1000;
  const start = end - days * 86400000;
  const trades = await fetchTrades(new Rpc(config.nodes), start, end);
  if (!trades[0] || trades[0].time > start + 86400000
    || trades[trades.length - 1]!.time < end - 86400000) {
    throw new Error('Historical coverage incomplete; select an archival RPC node');
  }
  const initialHive = numberEnv(process.env, 'BACKTEST_HIVE', 1000);
  const balancedHbd = config.inventoryTargetHbdPct < 1
    ? initialHive * trades[0]!.price * config.inventoryTargetHbdPct / (1 - config.inventoryTargetHbdPct)
    : 100;
  console.log(JSON.stringify({
    requestedStart: new Date(start).toISOString(), requestedDays: days,
    ...simulate(trades, config, {
      hive: initialHive,
      hbd: numberEnv(process.env, 'BACKTEST_HBD', balancedHbd),
    }, numberEnv(process.env, 'BACKTEST_SPREAD_PCT', 0.012, Number.EPSILON, 0.99), end),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Backtest failed');
    process.exitCode = 1;
  });
}
