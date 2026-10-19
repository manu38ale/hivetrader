import { PriceData } from '../types/hive';
import { fetchMedianPriceFeed } from './hiveApi';

export function pricesFromMedianFeed(feed: { base: string; quote: string }): PriceData {
  const parseAsset = (asset: string) => {
    const match = /^(\d+\.\d{3}) (HIVE|HBD)$/.exec(asset);
    const amount = match ? Number(match[1]) : NaN;
    if (!match || !Number.isFinite(amount) || amount <= 0) {
      throw new Error('Invalid asset in Hive median price feed');
    }
    return { amount, symbol: match[2] };
  };
  const base = parseAsset(feed.base);
  const quote = parseAsset(feed.quote);
  if (base.symbol === quote.symbol) {
    throw new Error('Hive median price feed must contain HIVE and HBD');
  }
  const hiveInHbd = base.symbol === 'HBD' ? base.amount / quote.amount : quote.amount / base.amount;
  const hbdInHive = 1 / hiveInHbd;
  if (![hiveInHbd, hbdInHive].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Invalid Hive median price ratio');
  }
  return { hiveInHbd, hbdInHive };
}

export async function fetchCurrentPrices(): Promise<PriceData> {
  return pricesFromMedianFeed(await fetchMedianPriceFeed());
}