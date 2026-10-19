import { useEffect, useState } from 'react';
import { fetchOrderBook, type OrderBookSnapshot } from '../utils/hiveApi';

export function OrderBook({ t }: { t: (key: string) => string }) {
  const [book, setBook] = useState<OrderBookSnapshot | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await fetchOrderBook();
        if (active) {
          setBook(result);
          setError(false);
        }
      } catch (cause) {
        console.error('Order book refresh failed:', cause);
        if (active) setError(true);
      } finally {
        if (active) timer = setTimeout(load, 15000);
      }
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, []);

  const bid = book?.bids[0]?.price;
  const ask = book?.asks[0]?.price;
  const mid = bid && ask ? (bid + ask) / 2 : undefined;
  return (
    <section aria-labelledby="order-book-title" className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <div className="flex flex-wrap justify-between gap-3 mb-4">
        <h2 id="order-book-title" className="text-lg font-semibold text-white">{t('orderBook.title')}</h2>
        <p className="text-sm text-gray-400">{t('orderBook.readOnly')}</p>
      </div>
      {error && <p role="alert" className="text-red-400 mb-4">{t('orderBook.error')}</p>}
      {!book && !error && <p role="status" className="text-gray-400">{t('loading.title')}</p>}
      {book && !error && <>
        {mid !== undefined && bid !== undefined && ask !== undefined &&
          <p className="text-sm text-gray-300 mb-4 tabular-nums">
            {t('orderBook.mid')}: {mid.toFixed(6)} HBD/HIVE
            {' | '}{t('orderBook.spread')}: {((ask - bid) / mid * 100).toFixed(3)}%
          </p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {(['bids', 'asks'] as const).map(side => (
            <div key={side} className="overflow-x-auto">
              <table className="w-full text-sm text-right tabular-nums">
                <caption className={`text-left font-medium mb-2 ${side === 'bids' ? 'text-green-400' : 'text-red-400'}`}>
                  {t(`orderBook.${side}`)}
                </caption>
                <thead className="text-gray-400">
                  <tr><th scope="col" className="py-2">{t('orderBook.price')}</th><th scope="col">HIVE</th><th scope="col">HBD</th></tr>
                </thead>
                <tbody className="text-gray-200">
                  {book[side].slice(0, 10).map((level, index) => (
                    <tr key={index} className="border-t border-gray-700">
                      <td className="py-2">{level.price.toFixed(6)}</td>
                      <td>{level.hive.toFixed(3)}</td><td>{level.hbd.toFixed(3)}</td>
                    </tr>
                  ))}
                  {!book[side].length && <tr><td colSpan={3} className="py-3 text-gray-400">{t('orderBook.empty')}</td></tr>}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </>}
    </section>
  );
}
