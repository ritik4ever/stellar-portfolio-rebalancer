import TelegramBotApi from 'node-telegram-bot-api'
import { logger } from '../utils/logger.js'
import { autoRebalancer } from '../services/runtimeServices.js'
import { portfolioStorage } from '../services/portfolioStorage.js'

const authorizedChatIds = new Set<string>()

export function registerChat(chatId: string): void {
  authorizedChatIds.add(chatId)
}

function isAuthorized(chatId: string): boolean {
  return authorizedChatIds.has(chatId)
}

async function getPortfolioStatus(): Promise<string> {
  const portfolios = await portfolioStorage.getAllPortfolios()
  if (portfolios.length === 0) return 'No portfolios found.'

  const totalValue = portfolios.reduce((sum, p) => sum + (p.totalValue || 0), 0)
  const totalDrift = portfolios.reduce((sum, p) => {
    const maxDrift = Math.max(
      ...Object.keys(p.allocations).map((asset) => {
        const target = p.allocations[asset] || 0
        const balance = p.balances[asset] || 0
        const currentPct = totalValue > 0 ? (balance / totalValue) * 100 : 0
        return Math.abs(currentPct - target)
      }),
      0,
    )
    return Math.max(sum, maxDrift)
  }, 0)

  return [
    `📊 *Portfolio Status*`,
    `Portfolios: ${portfolios.length}`,
    `Total Value: ${totalValue.toFixed(2)} XLM`,
    `Max Drift: ${totalDrift.toFixed(2)}%`,
    `Threshold: ${portfolios[0].threshold}%`,
  ].join('\n')
}

export function startBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    logger.warn('TELEGRAM_BOT_TOKEN not set, telegram bot not started')
    return
  }

  const bot = new TelegramBotApi(token, { polling: true })

  bot.onText(/\/status/, async (msg) => {
    const chatId = String(msg.chat.id)
    if (!isAuthorized(chatId)) {
      await bot.sendMessage(chatId, 'Unauthorized')
      return
    }
    try {
      const status = await getPortfolioStatus()
      await bot.sendMessage(chatId, status, { parse_mode: 'Markdown' })
    } catch (err) {
      await bot.sendMessage(chatId, `Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  bot.onText(/\/pause/, async (msg) => {
    const chatId = String(msg.chat.id)
    if (!isAuthorized(chatId)) {
      await bot.sendMessage(chatId, 'Unauthorized')
      return
    }
    try {
      autoRebalancer.stop()
      await bot.sendMessage(chatId, 'Rebalancing paused')
    } catch (err) {
      await bot.sendMessage(chatId, `Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  bot.onText(/\/resume/, async (msg) => {
    const chatId = String(msg.chat.id)
    if (!isAuthorized(chatId)) {
      await bot.sendMessage(chatId, 'Unauthorized')
      return
    }
    try {
      await autoRebalancer.start()
      await bot.sendMessage(chatId, 'Rebalancing resumed')
    } catch (err) {
      await bot.sendMessage(chatId, `Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  bot.onText(/\/start/, async (msg) => {
    const chatId = String(msg.chat.id)
    await bot.sendMessage(chatId, 'Welcome to Stellar Portfolio Rebalancer Bot\n\nAvailable commands:\n/status - Portfolio status\n/pause - Pause rebalancing\n/resume - Resume rebalancing')
  })

  logger.info('Telegram bot started in polling mode')
}
