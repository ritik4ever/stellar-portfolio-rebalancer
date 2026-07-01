import axios from 'axios'
import { logger } from '../utils/logger.js'

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`

export type RebalanceAlertData = {
  asset: string
  drift: number
  action: string
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    logger.warn('TELEGRAM_BOT_TOKEN not set, skipping message')
    return
  }

  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  })
}

export async function sendRebalanceAlert(
  chatId: string,
  { asset, drift, action }: RebalanceAlertData,
): Promise<void> {
  const text = [
    `🔄 *Rebalance Alert*`,
    `Asset: \`${asset}\``,
    `Drift: ${drift >= 0 ? '+' : ''}${drift.toFixed(2)}%`,
    `Action: ${action}`,
  ].join('\n')
  await sendTelegramMessage(chatId, text)
}

export async function sendCircuitBreakerAlert(
  chatId: string,
  reason: string,
): Promise<void> {
  const text = [
    `⚠️ *Circuit Breaker Triggered*`,
    `Reason: ${reason}`,
  ].join('\n')
  await sendTelegramMessage(chatId, text)
}

export async function sendPriceSpikeAlert(
  chatId: string,
  asset: string,
  change: number,
): Promise<void> {
  const emoji = change >= 0 ? '📈' : '📉'
  const text = [
    `${emoji} *Price Spike Alert*`,
    `Asset: \`${asset}\``,
    `Change: ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
  ].join('\n')
  await sendTelegramMessage(chatId, text)
}
