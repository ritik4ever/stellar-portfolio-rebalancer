/**
 * telegramLink.ts
 * Maps a Telegram chat to a Stellar address so bot commands can answer for the
 * *requesting* user's portfolios rather than the whole system (#1396).
 *
 * Backed by the existing kv_store table, so a link survives a restart.
 */

import { databaseService } from '../services/databaseService.js'
import { logger } from '../utils/logger.js'

const KV_PREFIX = 'telegram:link:'

/** In-memory mirror so lookups work even when the kv store is unavailable. */
const memoryLinks = new Map<string, string>()

function kvKey(chatId: string): string {
    return `${KV_PREFIX}${chatId}`
}

export function linkChat(chatId: string, userAddress: string): void {
    memoryLinks.set(chatId, userAddress)
    try {
        databaseService.setKvValue?.(kvKey(chatId), userAddress)
    } catch (error) {
        logger.warn('[TELEGRAM] Failed to persist chat link; keeping in-memory only', {
            chatId,
            error: error instanceof Error ? error.message : String(error),
        })
    }
}

export function getLinkedAddress(chatId: string): string | undefined {
    const cached = memoryLinks.get(chatId)
    if (cached) return cached

    try {
        const stored = databaseService.getKvValue?.(kvKey(chatId))
        if (stored) {
            memoryLinks.set(chatId, stored)
            return stored
        }
    } catch {
        // Fall through to "not linked" — the caller shows linking instructions.
    }
    return undefined
}

export function unlinkChat(chatId: string): boolean {
    const had = memoryLinks.delete(chatId)
    try {
        databaseService.deleteKvValue?.(kvKey(chatId))
    } catch {
        // Best effort; the in-memory mirror is already cleared.
    }
    return had
}

/** Test seam. */
export function resetTelegramLinksForTests(): void {
    memoryLinks.clear()
}
