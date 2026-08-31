/**
 * telegramCommands.ts
 * Command handlers for the Telegram bot, kept free of the bot transport so they
 * can be driven directly from a mocked update payload in tests (#1396).
 */

import { portfolioStorage } from '../services/portfolioStorage.js'
import { getLinkedAddress } from './telegramLink.js'
import { logger } from '../utils/logger.js'
import type { Portfolio } from '../types/index.js'

/** The subset of a Telegram update the command handlers actually read. */
export interface TelegramUpdateMessage {
    chat: { id: number | string }
    from?: { id: number | string; username?: string }
    text?: string
}

export interface TelegramReply {
    text: string
    parseMode?: 'Markdown'
}

export const LINK_INSTRUCTIONS = [
    '🔗 *Link your account first*',
    '',
    'This chat is not linked to a Stellar address yet, so there are no portfolios to report on.',
    '',
    'To link:',
    '1. Open the Stellar Portfolio Rebalancer web app.',
    '2. Go to *Settings → Notifications → Telegram*.',
    '3. Enter this chat ID and confirm with your wallet signature.',
    '',
    'Once linked, send /status again to see your portfolios.',
].join('\n')

/**
 * Largest absolute gap between an asset's target allocation and its current
 * share of the portfolio, in percentage points. Mirrors the drift definition
 * used elsewhere in the app.
 */
export function computeMaxDrift(portfolio: Portfolio): number {
    const totalValue = portfolio.totalValue || 0
    const assets = Object.keys(portfolio.allocations || {})
    if (assets.length === 0 || totalValue <= 0) return 0

    return assets.reduce((max, asset) => {
        const target = portfolio.allocations[asset] || 0
        const balance = portfolio.balances?.[asset] || 0
        const currentPct = (balance / totalValue) * 100
        return Math.max(max, Math.abs(currentPct - target))
    }, 0)
}

function formatLastRebalance(value?: string): string {
    if (!value) return 'never'
    const date = new Date(value)
    if (isNaN(date.getTime())) return 'never'
    return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

function formatPortfolio(portfolio: Portfolio): string {
    const drift = computeMaxDrift(portfolio)
    const totalValue = portfolio.totalValue || 0

    const allocationLines = Object.entries(portfolio.allocations || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([asset, target]) => {
            const balance = portfolio.balances?.[asset] || 0
            const currentPct = totalValue > 0 ? (balance / totalValue) * 100 : 0
            return `  • ${asset}: ${currentPct.toFixed(1)}% / ${target}% target`
        })

    return [
        `*${portfolio.name || portfolio.id}*`,
        `Value: ${totalValue.toFixed(2)} USD`,
        'Allocation (current / target):',
        ...(allocationLines.length > 0 ? allocationLines : ['  • no allocations configured']),
        `Max drift: ${drift.toFixed(2)}% (threshold ${portfolio.threshold}%)`,
        `${drift > portfolio.threshold ? '⚠️ Rebalance due' : '✅ Within threshold'}`,
        `Last rebalance: ${formatLastRebalance(portfolio.lastRebalance)}`,
    ].join('\n')
}

/**
 * `/status` — on-demand portfolio status for the requesting user.
 *
 * An unlinked chat gets linking instructions rather than an error, so a new user
 * is told what to do instead of hitting a dead end.
 */
export async function handleStatusCommand(
    message: TelegramUpdateMessage,
): Promise<TelegramReply> {
    const chatId = String(message.chat.id)
    const userAddress = getLinkedAddress(chatId)

    if (!userAddress) {
        return { text: LINK_INSTRUCTIONS, parseMode: 'Markdown' }
    }

    try {
        const portfolios = await portfolioStorage.getUserPortfolios(userAddress)

        if (portfolios.length === 0) {
            return {
                text: [
                    '📊 *Portfolio Status*',
                    '',
                    'No portfolios found for your linked account yet.',
                    'Create one in the web app and it will show up here.',
                ].join('\n'),
                parseMode: 'Markdown',
            }
        }

        const header = [
            '📊 *Portfolio Status*',
            `${portfolios.length} portfolio${portfolios.length === 1 ? '' : 's'} linked to this chat`,
            '',
        ].join('\n')

        return {
            text: header + portfolios.map(formatPortfolio).join('\n\n'),
            parseMode: 'Markdown',
        }
    } catch (error) {
        logger.error('[TELEGRAM] /status failed', {
            chatId,
            error: error instanceof Error ? error.message : String(error),
        })
        return {
            text: '⚠️ Could not load your portfolio status right now. Please try again shortly.',
        }
    }
}
