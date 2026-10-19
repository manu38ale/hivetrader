import type { Config } from './config.js';
import type { RiskState } from './types.js';

export type NotificationEvent = 'started' | 'daily_loss_halted' | 'toxic_pause_started'
  | 'toxic_pause_ended' | 'broadcast_failed' | 'stopped';
export type Notify = (event: NotificationEvent, reason: string, now?: number) => Promise<void>;

export function createNotifier(account: string, env: NodeJS.ProcessEnv = process.env): Notify {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) {
    console.log(JSON.stringify({ event: 'telegram_disabled', reason: 'missing Telegram configuration' }));
    return async () => {};
  }
  return async (event, reason, now = Date.now()) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let text = `Hive bot: ${account}\nUTC: ${new Date(now).toISOString()}\nEvent: ${event}\nReason: ${reason}`;
        for (const secret of [env.BOT_ACTIVE_KEY, token, chatId]) {
          if (secret) text = text.replaceAll(secret, '[redacted]');
        }
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) continue;
        const result: unknown = await response.json();
        if (typeof result === 'object' && result !== null && 'ok' in result && result.ok === true) return;
      } catch {
        // Never log transport exceptions: their URL can contain the bot token.
      }
    }
    console.error(JSON.stringify({ event: 'telegram_delivery_failed', notificationEvent: event, attempts: 2 }));
  };
}

export function riskNotifications(
  previous: RiskState | undefined, next: RiskState, now: number, dailyPnl: number, config: Config,
): { event: NotificationEvent; reason: string }[] {
  const notifications: { event: NotificationEvent; reason: string }[] = [];
  if (!previous?.halted && next.halted && -dailyPnl > config.maxDailyLossHbd) {
    notifications.push({
      event: 'daily_loss_halted',
      reason: `Daily P&L ${dailyPnl.toFixed(3)} HBD; loss limit ${config.maxDailyLossHbd.toFixed(3)} HBD exceeded; manual review required`,
    });
  }
  const previousDeadline = previous?.pauseUntil ?? 0;
  const previousTime = previous?.samples.at(-1)?.time ?? now;
  if (previousDeadline > previousTime && now >= previousDeadline) {
    notifications.push({ event: 'toxic_pause_ended', reason: 'Toxic-move pause elapsed; other risk breakers still apply' });
  }
  if (next.pauseUntil > now && previousDeadline <= now) {
    notifications.push({
      event: 'toxic_pause_started',
      reason: `Toxic mid move exceeded ${(config.toxicMovePct * 100).toFixed(2)}% in ${config.toxicWindowMin} min; paused until ${new Date(next.pauseUntil).toISOString()}`,
    });
  }
  return notifications;
}
