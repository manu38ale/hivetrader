import { useState, type FormEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { es, enUS } from 'date-fns/locale';
import type { Language } from '../hooks/useLanguage';
import { useBotDashboard } from '../hooks/useBotDashboard';
import type { BotPeriod } from '../types/bot';
import { calculateBotMetrics } from '../utils/botMetrics';
import { formatCurrency } from '../utils/calculations';
import { OperationsTable } from '../components/OperationsTable';
import { OrderBook } from '../components/OrderBook';

export function BotPage({ active, language, t }: { active: boolean; language: Language; t: (key: string) => string }) {
  const [account, setAccount] = useState<string>(import.meta.env.VITE_BOT_ACCOUNT?.trim() ?? '');
  const [input, setInput] = useState(account);
  const [period, setPeriod] = useState<BotPeriod>('30d');
  const [page, setPage] = useState(1);
  const [invalidAccount, setInvalidAccount] = useState(false);
  const { data, error, loading, refresh } = useBotDashboard(account, period, active);
  const dateLocale = language === 'es' ? es : enUS;
  const metrics = data ? calculateBotMetrics(data.snapshot, data.operations) : null;
  const totalPages = Math.max(1, Math.ceil((data?.operations.length ?? 0) / 25));
  const currentPage = Math.min(page, totalPages);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = input.trim();
    if (!/^[a-z][a-z0-9.-]{2,15}$/.test(next)) { setInvalidAccount(true); return; }
    setInvalidAccount(false);
    setPage(1);
    if (next === account) refresh();
    else setAccount(next);
  };
  const showData = data && metrics && !error;

  return (
    <div className="space-y-8">
      <section aria-labelledby="bot-title" className="space-y-5">
        <div className="flex flex-wrap justify-between items-start gap-4">
          <div>
            <h2 id="bot-title" className="text-2xl font-semibold text-white">{t('bot.title')}</h2>
            <p className="mt-1 text-sm text-gray-400">{t('bot.readOnly')}</p>
          </div>
          {account && <button type="button" onClick={refresh} disabled={loading} className="flex items-center gap-2 px-3 py-2 rounded-md border border-gray-600 text-sm disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
            <RefreshCw aria-hidden="true" className="w-4 h-4" />{t('header.refresh')}
          </button>}
        </div>
        <div className="flex flex-wrap gap-4 items-end">
          <form onSubmit={submit} className="flex flex-wrap items-end gap-2 flex-1">
            <div className="flex-1 min-w-48">
              <label htmlFor="bot-account" className="block text-sm text-gray-400 mb-2">{t('bot.account')}</label>
              <input id="bot-account" value={input} onChange={event => { setInput(event.target.value); setInvalidAccount(false); }} placeholder={t('bot.accountPlaceholder')}
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <button type="submit" disabled={!input.trim()} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
              {t('bot.monitor')}
            </button>
          </form>
          <div>
            <label htmlFor="bot-period" className="block text-sm text-gray-400 mb-2">{t('bot.period')}</label>
            <select id="bot-period" value={period} onChange={event => { setPeriod(event.target.value as BotPeriod); setPage(1); }}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-400">
              {(['24h', '7d', '30d', 'all'] as const).map(value => <option key={value} value={value}>{t(`bot.periods.${value}`)}</option>)}
            </select>
          </div>
        </div>
        {invalidAccount && <p role="alert" className="text-red-400 text-sm">{t('bot.errors.invalidAccount')}</p>}
        {!account && <p className="p-4 bg-gray-800 border border-gray-700 rounded-md text-gray-300">{t('bot.configure')}</p>}
        {error && <p role="alert" className="p-4 bg-red-900/20 border border-red-800 rounded-md text-red-300">{t(`bot.errors.${error}`)}</p>}
        {loading && <p role="status" className="text-sm text-gray-400">{t(data ? 'bot.refreshing' : 'bot.loading')}</p>}
      </section>

      {showData && <>
        <section aria-labelledby="bot-summary-title" className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="flex flex-wrap justify-between gap-2 px-6 py-4 border-b border-gray-700">
            <h3 id="bot-summary-title" className="text-lg font-semibold text-white">{t('bot.summary')} <span className="text-gray-400 font-normal">@{account}</span></h3>
            <p className="text-xs text-gray-400 self-center">{t('header.lastUpdate')}: {format(new Date(data.snapshot.updatedAt), 'dd/MM/yyyy HH:mm:ss', { locale: dateLocale })}</p>
          </div>
          <div className="grid lg:grid-cols-2">
            <dl className="grid sm:grid-cols-2 gap-6 p-6">
              {([
                ['HBD', metrics.totalHbd, data.snapshot.freeHbd, data.snapshot.reservedHbd],
                ['HIVE', metrics.totalHive, data.snapshot.freeHive, data.snapshot.reservedHive],
              ] as const).map(([symbol, total, free, reserved]) => (
                <div key={symbol}>
                  <dt className="text-gray-300">{t('bot.balance')} {symbol}</dt>
                  <dd className="mt-1 text-2xl font-semibold text-white tabular-nums">{formatCurrency(total)} <span className="text-sm font-normal text-gray-400">{symbol}</span></dd>
                  <dd className="mt-3 text-xs text-gray-400 leading-6 tabular-nums">
                    {t('bot.available')}: {formatCurrency(free)} {symbol}<br />
                    {t('bot.reserved')}: {formatCurrency(reserved)} {symbol}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="p-6 border-t lg:border-t-0 lg:border-l border-gray-700">
              <h4 className="text-gray-300">{t('bot.pnl')} <span className="text-xs text-gray-400">({t(`bot.periods.${period}`)})</span></h4>
              <p className={`mt-1 text-3xl font-semibold tabular-nums ${metrics.pnlHbd < 0 ? 'text-red-400' : metrics.pnlHbd > 0 ? 'text-green-400' : 'text-white'}`}>
                {metrics.pnlHbd > 0 ? '+' : ''}{formatCurrency(metrics.pnlHbd)} <span className="text-base font-normal">HBD</span>
              </p>
              <p className="mt-3 text-xs text-gray-400 leading-relaxed max-w-prose">{t('bot.pnlNote')}</p>
              <p className="mt-2 text-xs text-gray-400 tabular-nums">{t('bot.mid')}: {data.snapshot.mid.toFixed(6)} HBD/HIVE</p>
            </div>
          </div>
          <dl className="grid sm:grid-cols-3 gap-5 px-6 py-5 border-t border-gray-700">
            <div><dt className="text-sm text-gray-400">{t('bot.volumeHive')}</dt><dd className="mt-1 text-lg text-white tabular-nums">{formatCurrency(metrics.volumeHive)} HIVE</dd></div>
            <div><dt className="text-sm text-gray-400">{t('bot.volumeHbd')}</dt><dd className="mt-1 text-lg text-white tabular-nums">{formatCurrency(metrics.volumeHbd)} HBD</dd></div>
            <div><dt className="text-sm text-gray-400">{t('bot.fills')}</dt><dd className="mt-1 text-lg text-white tabular-nums">{metrics.fills}</dd></div>
          </dl>
          <div className="px-6 py-4 border-t border-gray-700 text-xs text-gray-400 space-y-2">
            <p className="tabular-nums">{t('bot.equity')}: {formatCurrency(metrics.equityHbd)} HBD | {t('bot.excludes')}</p>
            <p>{t('bot.volumeNote')}</p>
            <p>{t('bot.historyUpdate')}: {format(new Date(data.historyUpdatedAt), 'dd/MM/yyyy HH:mm:ss', { locale: dateLocale })}</p>
          </div>
        </section>

        <section aria-labelledby="bot-orders-title" className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <h3 id="bot-orders-title" className="px-6 py-4 border-b border-gray-700 text-lg font-semibold text-white">{t('bot.openOrders')} ({data.snapshot.orders.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-left">
                <tr>
                  <th scope="col" className="px-6 py-3">ID</th><th scope="col" className="px-6 py-3">{t('operationsTable.type')}</th>
                  <th scope="col" className="px-6 py-3 text-right">{t('bot.remaining')} HIVE</th><th scope="col" className="px-6 py-3 text-right">{t('bot.remaining')} HBD</th>
                  <th scope="col" className="px-6 py-3 text-right">HBD/HIVE</th><th scope="col" className="px-6 py-3">{t('bot.expires')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700 tabular-nums">
                {data.snapshot.orders.map(order => (
                  <tr key={order.id}>
                    <td className="px-6 py-4">{order.id}</td>
                    <td className={`px-6 py-4 ${order.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>{t(`operationsTable.${order.side}`)}</td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">{formatCurrency(order.remainingHive)}</td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">{formatCurrency(order.remainingHbd)}</td>
                    <td className="px-6 py-4 text-right">{order.price.toFixed(6)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{format(new Date(order.expiresAt), 'dd/MM/yyyy HH:mm', { locale: dateLocale })}</td>
                  </tr>
                ))}
                {!data.snapshot.orders.length && <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400">{t('bot.noOrders')}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-label={t('bot.executed')} className="space-y-3">
          <OperationsTable operations={data.operations.slice((currentPage - 1) * 25, currentPage * 25)} isLoading={false}
            t={t} dateLocale={dateLocale} title={t('bot.executed')} emptyDescription={t('bot.noFills')}
            totalCount={data.operations.length} priceDecimals={6} priceLabel="HBD/HIVE" />
          {totalPages > 1 && <nav aria-label={t('bot.pagination')} className="flex flex-wrap justify-end items-center gap-3 text-sm">
            <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="px-3 py-2 border border-gray-600 rounded disabled:opacity-40 focus-visible:outline focus-visible:outline-2">{t('bot.previous')}</button>
            <span>{currentPage} / {totalPages}</span>
            <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} className="px-3 py-2 border border-gray-600 rounded disabled:opacity-40 focus-visible:outline focus-visible:outline-2">{t('bot.next')}</button>
          </nav>}
        </section>
      </>}
      {active && <OrderBook t={t} />}
    </div>
  );
}
