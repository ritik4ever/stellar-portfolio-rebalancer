import { sendRebalanceAlert, sendCircuitBreakerAlert, sendPriceSpikeAlert } from './telegram.js'
import type { NotificationPreferences } from '../db/notificationDb.js'
import { logger } from '../utils/logger.js'

export async function sendTelegramNotification(
  eventType: 'rebalance' | 'circuit_breaker' | 'price_spike',
  data: Record<string, unknown>,
  preferences: NotificationPreferences,
): Promise<void> {
  const chatId = (preferences as Record<string, unknown>).telegramChatId as string | undefined
  if (!chatId) return

  try {
    switch (eventType) {
      case 'rebalance':
        await sendRebalanceAlert(chatId, data as { asset: string; drift: number; action: string })
        break
      case 'circuit_breaker':
        await sendCircuitBreakerAlert(chatId, data.reason as string)
        break
      case 'price_spike':
        await sendPriceSpikeAlert(chatId, data.asset as string, data.change as number)
        break
    }
  } catch (err) {
    logger.error('Failed to send telegram notification', {
      eventType,
      chatId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
