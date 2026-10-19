import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig, numberEnv } from './config.js';
import { Executor } from './executor.js';
import { Rpc, readBalances, readBook, readOrders } from './market.js';
import { checkRisk } from './risk.js';
import { openState } from './state.js';
import { decide, equity, totalBalances } from './strategy.js';
import { appendSpreadSample } from './spreadHistory.js';
import { createNotifier, riskNotifications } from './notify.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (process.argv.includes('--paper')) config.paper = true;
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(config.account)) {
    throw new Error('Set BOT_ACCOUNT to a dedicated Hive bot account');
  }
  const duration = numberEnv(process.env, 'RUN_DURATION_SEC', 0);
  const store = await openState(config);
  let stopping = false;
  const controller = new AbortController();
  const stop = () => { stopping = true; controller.abort(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const rpc = new Rpc(config.nodes);
  try {
    const notify = createNotifier(config.account);
    const executor = new Executor(config, rpc, store.state, store.save, process.env.BOT_ACTIVE_KEY, notify);
    const started = Date.now();
    console.log(JSON.stringify({ event: 'started', account: config.account, paper: config.paper }));
    await notify('started', `${config.paper ? 'Paper' : 'Live'} mode; polling every ${config.pollIntervalSec}s${store.state.risk?.halted ? '; persisted risk halt requires manual review' : ''}`);
    while (!stopping && (!duration || Date.now() - started < duration * 1000)) {
      const cycleStarted = Date.now();
      try {
        const [market, openOrders, accountBalances] = await Promise.allSettled([
          readBook(rpc).then(book => ({ book, time: Date.now() })),
          readOrders(rpc, config.account), readBalances(rpc, config.account),
        ]);
        if (market.status === 'rejected') throw market.reason;
        const { book, time } = market.value;
        try {
          await appendSpreadSample(config.stateDir, {
            time: new Date(time).toISOString(), mid: book.mid, spreadPct: book.spreadPct,
          });
        } catch {
          console.error(JSON.stringify({ event: 'spread_history_failed', action: 'check STATE_DIR permissions and disk space' }));
        }
        if (openOrders.status === 'rejected') throw openOrders.reason;
        if (accountBalances.status === 'rejected') throw accountBalances.reason;
        const chainOrders = openOrders.value;
        const balances = accountBalances.value;
        const now = Date.now();
        if (config.paper) {
          executor.initializePaper({
            hive: numberEnv(process.env, 'PAPER_HIVE', balances.hive),
            hbd: numberEnv(process.env, 'PAPER_HBD', balances.hbd),
          });
          executor.expirePaper(now);
        }
        const orders = config.paper ? executor.paperOrders : chainOrders;
        const free = config.paper ? executor.paperFree! : balances;
        for (const order of orders) {
          store.state.lastOrderId = Math.max(store.state.lastOrderId, order.id);
        }
        const previousRisk = store.state.risk;
        const risk = checkRisk(previousRisk, now, book.mid,
          equity(totalBalances(free, orders), book.mid), config);
        store.state.risk = risk.state;
        await store.save();
        for (const notification of riskNotifications(previousRisk, risk.state, now, risk.dailyPnl, config)) {
          await notify(notification.event, notification.reason, now);
        }
        const activeIds = new Set(orders.map(order => String(order.id)));
        for (const id of Object.keys(store.state.anchors)) {
          if (!activeIds.has(id)) delete store.state.anchors[id];
        }
        const decision = decide(book, free, orders, store.state.anchors, now, config, risk.reason);
        console.log(JSON.stringify({
          event: 'decision', time: new Date(now).toISOString(), paper: config.paper,
          book, dailyPnlHbd: risk.dailyPnl, breaker: risk.reason ?? 'clear',
          observedChainOrders: chainOrders.length, ...decision,
        }));
        await executor.execute(decision, book.mid, now);
      } catch (error) {
        console.error(JSON.stringify({ event: 'cycle_failed', message: error instanceof Error
          ? error.message : 'Unknown cycle failure', action: 'cancel all; no new quotes' }));
        try {
          const orders = config.paper ? executor.paperOrders : await readOrders(rpc, config.account);
          await executor.execute({
            cancel: orders.map(order => order.id), create: [],
            reason: 'unhealthy cycle', spreadPct: 0, skew: 0,
          }, 0, Date.now());
        } catch {
          console.error(JSON.stringify({ event: 'cancel_failed', action: 'manual chain inspection required' }));
        }
      }
      const remaining = duration ? duration * 1000 - (Date.now() - started) : Infinity;
      const wait = Math.min(config.pollIntervalSec * 1000 - (Date.now() - cycleStarted), remaining);
      if (!stopping && wait > 0) {
        try { await sleep(wait, undefined, { signal: controller.signal }); }
        catch (error) {
          if (!(error instanceof Error && error.name === 'AbortError')) throw error;
        }
      }
    }
    const orders = config.paper ? executor.paperOrders : await readOrders(rpc, config.account);
    const shutdown = await executor.execute({
      cancel: orders.map(order => order.id), create: [], reason: 'shutdown', spreadPct: 0, skew: 0,
    }, 0, Date.now());
    if (shutdown === 'insufficient_rc' || shutdown === 'rc_unavailable') {
      throw new Error('Shutdown could not cancel orders due to RC pre-check; inspect remaining chain orders manually');
    }
    console.log(JSON.stringify({ event: 'stopped', paper: config.paper }));
    await notify('stopped', `Clean shutdown in ${config.paper ? 'paper' : 'live'} mode; managed orders cancelled`);
  } finally {
    await store.release();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Fatal bot error');
  process.exitCode = 1;
});
