import { PrivateKey, type Operation } from '@hiveio/dhive';
import type { Config } from './config.js';
import { Rpc, parseAsset } from './market.js';
import type { Balances, Decision, OpenOrder, PersistentState } from './types.js';

export function nextOrderId(previous: number, now: number): number {
  // Unix seconds plus a monotonic counter; persisted before any broadcast.
  const id = Math.max(Math.floor(now / 1000), previous + 1);
  if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) throw new Error('Order ID space exhausted');
  return id;
}

export class Executor {
  private readonly key?: PrivateKey;
  paperOrders: OpenOrder[] = [];
  paperFree?: Balances;

  constructor(
    private readonly config: Config, private readonly rpc: Rpc,
    private readonly state: PersistentState, private readonly save: () => Promise<void>,
    activeKey?: string,
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

  async execute(decision: Decision, mid: number, now: number): Promise<void> {
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
    if (!operations.length) return;
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
      return;
    }
    if (!this.key) throw new Error('Missing ACTIVE key');
    try {
      // One atomic transaction. Never retry with new IDs after an ambiguous response.
      await this.rpc.client().broadcast.sendOperations(operations, this.key);
      console.log(JSON.stringify({ event: 'broadcast_confirmed', orders: created.map(order => order.id) }));
    } catch {
      this.rpc.rotate();
      if (this.state.risk) this.state.risk.halted = true;
      await this.save();
      throw new Error('Broadcast failed or uncertain; risk latched. Reconcile chain orders before manual resume.');
    }
  }
}
