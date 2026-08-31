import TelegramBotApi from 'node-telegram-bot-api'
import { logger } from '../utils/logger.js'
import { autoRebalancer } from '../services/runtimeServices.js'
import { handleStatusCommand, LINK_INSTRUCTIONS } from './telegramCommands.js'
import { linkChat, unlinkChat } from './telegramLink.js'

const authorizedChatIds = new Set<string>()

export function registerChat(chatId: string): void {
  authorizedChatIds.add(chatId)
}

function isAuthorized(chatId: string): boolean {
  return authorizedChatIds.has(chatId)
}

export function startBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    logger.warn('TELEGRAM_BOT_TOKEN not set, telegram bot not started')
    return
  }

  const bot = new TelegramBotApi(token, { polling: true })

  // /status reports on the chat's *linked* user rather than the whole system.
  // An unlinked chat gets linking instructions instead of a bare error (#1396).
  bot.onText(/\/status/, async (msg) => {
    const chatId = String(msg.chat.id)
    const reply = await handleStatusCommand(msg as never)
    await bot.sendMessage(
      chatId,
      reply.text,
      reply.parseMode ? { parse_mode: reply.parseMode } : undefined,
    )
  })

  bot.onText(/\/link (.+)/, async (msg, match) => {
    const chatId = String(msg.chat.id)
    const address = match?.[1]?.trim()
    if (!address) {
      await bot.sendMessage(chatId, LINK_INSTRUCTIONS, { parse_mode: 'Markdown' })
      return
    }
    linkChat(chatId, address)
    registerChat(chatId)
    await bot.sendMessage(
      chatId,
      `This chat is now linked to ${address}. Send /status to see your portfolios.`,
    )
  })

  bot.onText(/\/unlink/, async (msg) => {
    const chatId = String(msg.chat.id)
    const had = unlinkChat(chatId)
    await bot.sendMessage(
      chatId,
      had ? 'This chat is no longer linked.' : 'This chat was not linked.',
    )
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
    await bot.sendMessage(
      chatId,
      'Welcome to Stellar Portfolio Rebalancer Bot\n\nAvailable commands:\n/link <address> - Link this chat to your account\n/status - Your portfolio status\n/unlink - Unlink this chat\n/pause - Pause rebalancing\n/resume - Resume rebalancing',
    )
  })

  logger.info('Telegram bot started in polling mode')
}
