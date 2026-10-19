import { PrivateKey, type Operation } from '@hiveio/dhive';
import type { Config } from './config.js';
import { Rpc, estimateRcCost, parseAsset, readRc, type MarketOperation } from './market.js';
import type { Notify } from './notify.js';
import type { Balances, Decision, OpenOrder, PersistentState } from './types.js';

export function nextOrderId(previous: number, now: number): number {
  // Unix seconds plus a monotonic counter; persisted before any broadcast.
  const id = Math.max(Math.floor(now / 1000), previous + 1);
  if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) throw new Error('Order ID space exhausted');
  return id;
}

export type ExecutionStatus = 'noop' | 'paper' | 'broadcast' | 'insufficient_rc' | 'rc_unavailable';

export class Executor {
  private readonly key?: PrivateKey;
  paperOrders: OpenOrder[] = [];
  paperFree?: Balances;

  constructor(
    private readonly config: Config, private readonly rpc: Rpc,
    private readonly state: PersistentState, private readonly save: () => Promise<void>,
    activeKey?: string,
    private readonly notify: Notify = async () => {},
  ) {
    if (!config.paper) {
      if (!activeKey) throw new Error('Live mode requires BOT_ACTIVE_KEY (ACTIVE authority)');
      try { this.key = PrivateKey.fromString(activeKey); }
      catch { throw new Error('Invalid BOT_ACTIVE_KEY'); }
    }
  }

  initializePaper(free: Balances): void {
    if (!this.paperFree) this.paperFree = { ...free };
  }

  expirePaper(now: number): void {
    if (!this.paperFree) return;
    for (const order of this.paperOrders.filter(order => order.expires <= now)) {
      this.paperFree[order.side === 'bid' ? 'hbd' : 'hive'] += order.sell;
      delete this.state.anchors[order.id];
    }
    this.paperOrders = this.paperOrders.filter(order => order.expires > now);
  }

  private async precheckRc(decision: Decision): Promise<'ready' | 'insufficient_rc' | 'rc_unavailable'> {
    try {
      const rc = await readRc(this.rpc, this.config.account);
      const operations: MarketOperation[] = [
        ...decision.cancel.map(() => 'limit_order_cancel' as const),
        ...decision.create.map(() => 'limit_order_create' as const),
      ];
      if (rc.current === 0n || rc.current < await estimateRcCost(this.rpc, operations)) {
        console.error(`insufficient RC: ${rc.current}/${rc.max}`);
        return 'insufficient_rc';
      }
      return 'ready';
    } catch {
      console.error(JSON.stringify({ event: 'rc_precheck_failed', action: 'skip transaction; RC availability or cost could not be verified; no risk halt' }));
      return 'rc_unavailable';
    }
  }

  async execute(decision: Decision, mid: number, now: number): Promise<ExecutionStatus> {
    if (!this.config.paper && decision.cancel.length + decision.create.length > 0) {
      const preflight = await this.precheckRc(decision);
      if (preflight !== 'ready') {
        await this.save();
        return preflight;
      }
    }
    const operations: Operation[] = [];
    for (const id of decision.cancel) {
      operations.push(['limit_order_cancel', { owner: this.config.account, orderid: id }]);
    }
    const created: OpenOrder[] = [];
    for (const quote of decision.create) {
      const id = nextOrderId(this.state.lastOrderId, now);
      this.state.lastOrderId = id;
      const expires = now + this.config.orderExpirationMin * 60000;
      operations.push(['limit_order_create', {
        owner: this.config.account, orderid: id,
        amount_to_sell: quote.amountToSell, min_to_receive: quote.minToReceive,
        fill_or_kill: false, expiration: new Date(expires).toISOString().slice(0, 19),
      }]);
      created.push({
        id, side: quote.side, sell: parseAsset(quote.amountToSell).amount,
        price: quote.price, created: now, expires,
      });
      this.state.anchors[id] = { mid };
    }
    for (const id of decision.cancel) delete this.state.anchors[id];
    await this.save();
    if (!operations.length) return 'noop';
    if (this.config.paper) {
      if (!this.paperFree) throw new Error('Paper balances not initialized');
      for (const order of this.paperOrders.filter(order => decision.cancel.includes(order.id))) {
        this.paperFree[order.side === 'bid' ? 'hbd' : 'hive'] += order.sell;
      }
      this.paperOrders = this.paperOrders.filter(order => !decision.cancel.includes(order.id));
      for (const order of created) {
        const symbol = order.side === 'bid' ? 'hbd' : 'hive';
        if (this.paperFree[symbol] + 1e-9 < order.sell) throw new Error('Paper overspend');
        this.paperFree[symbol] -= order.sell;
      }
      this.paperOrders.push(...created);
      console.log(JSON.stringify({ event: 'paper_operations', signed: false, broadcast: false, operations }));
      return 'paper';
    }
    if (!this.key) throw new Error('Missing ACTIVE key');
    try {
      // One atomic transaction. Never retry with new IDs after an ambiguous response.
      await this.rpc.client().broadcast.sendOperations(operations, this.key);
      console.log(JSON.stringify({ event: 'broadcast_confirmed', orders: created.map(order => order.id) }));
      return 'broadcast';
    } catch {
      this.rpc.rotate();
      if (this.state.risk) this.state.risk.halted = true;
      await this.save();
      await this.notify('broadcast_failed', 'Transaction failed or confirmation uncertain; risk latched; manual chain reconciliation required', now);
      throw new Error('Broadcast failed or uncertain; risk latched. Reconcile chain orders before manual resume.');
    }
  }
}
