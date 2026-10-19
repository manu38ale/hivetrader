import { useEffect, useState } from 'react';
import type { BotDashboardData, BotPeriod } from '../types/bot';
import { BotDataError, fetchBotOperations, fetchBotSnapshot } from '../utils/botApi';
import { periodStart } from '../utils/botMetrics';

export function useBotDashboard(account: string, period: BotPeriod, active = true) {
  const [data, setData] = useState<BotDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!active) { setLoading(false); return; }
    setData(null);
    setError(null);
    if (!account) { setLoading(false); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let historyUpdatedAt = 0;
    let operations: BotDashboardData['operations'] = [];
    const load = async () => {
      setLoading(true);
      try {
        const refreshHistory = Date.now() - historyUpdatedAt >= 60000;
        const [snapshot, history] = await Promise.all([
          fetchBotSnapshot(account, controller.signal),
          refreshHistory ? fetchBotOperations(account, periodStart(period, Date.now()), controller.signal) : undefined,
        ]);
        if (controller.signal.aborted) return;
        if (history !== undefined) {
          operations = history;
          historyUpdatedAt = Date.now();
        }
        const since = periodStart(period, Date.now());
        setData({
          account, period, snapshot, historyUpdatedAt,
          operations: since === undefined ? operations : operations.filter(op => Date.parse(op.timestamp) >= since),
        });
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error('Bot dashboard refresh failed:', cause);
        setError(cause instanceof BotDataError ? cause.code : 'connection');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(load, 15000);
        }
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [account, period, revision, active]);

  return {
    data: data?.account === account && data.period === period ? data : null,
    error, loading, refresh: () => setRevision(value => value + 1),
  };
}
