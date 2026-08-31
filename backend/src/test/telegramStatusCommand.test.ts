/**
 * Telegram /status command (#1396).
 *
 * Drives the handler with mocked Telegram update payloads: a linked user with
 * active portfolios, and an unlinked chat that must receive linking instructions
 * rather than an error.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// kv-backed link store — mocked so the suite stays off the native sqlite binding.
const kv = new Map<string, string>()

vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        getKvValue: vi.fn((k: string) => kv.get(k)),
        setKvValue: vi.fn((k: string, v: string) => { kv.set(k, v) }),
        deleteKvValue: vi.fn((k: string) => kv.delete(k)),
    },
}))

const mockGetUserPortfolios = vi.fn()

vi.mock('../services/portfolioStorage.js', () => ({
    portfolioStorage: { getUserPortfolios: (...a: unknown[]) => mockGetUserPortfolios(...a) },
}))

const CHAT_ID = 987654321
const USER = 'GUSERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

/** A minimal but realistic Telegram update message payload. */
function statusUpdate(chatId: number | string = CHAT_ID) {
    return {
        message_id: 42,
        from: { id: 111, is_bot: false, username: 'someone' },
        chat: { id: chatId, type: 'private' as const },
        date: Math.floor(Date.now() / 1000),
        text: '/status',
    }
}

function portfolio(overrides: Record<string, unknown> = {}) {
    return {
        id: 'portfolio-abc',
        userAddress: USER,
        name: 'Core Portfolio',
        allocations: { XLM: 60, USDC: 40 },
        balances: { XLM: 700, USDC: 300 },
        totalValue: 1000,
        threshold: 5,
        createdAt: '2026-01-01T00:00:00Z',
        lastRebalance: '2026-08-01T12:30:00Z',
        version: 1,
        ...overrides,
    }
}

async function loadCommands() {
    return import('../notifications/telegramCommands.js')
}

async function loadLink() {
    return import('../notifications/telegramLink.js')
}

describe('telegram /status command (#1396)', () => {
    beforeEach(async () => {
        kv.clear()
        vi.clearAllMocks()
        const { resetTelegramLinksForTests } = await loadLink()
        resetTelegramLinksForTests()
    })

    describe('unlinked chats', () => {
        it('returns linking instructions instead of an error', async () => {
            const { handleStatusCommand, LINK_INSTRUCTIONS } = await loadCommands()

            const reply = await handleStatusCommand(statusUpdate() as never)

            expect(reply.text).toBe(LINK_INSTRUCTIONS)
            expect(reply.text).toContain('Link your account first')
            expect(reply.text).toContain('/status')
            expect(reply.text.toLowerCase()).not.toContain('error')
            expect(reply.text.toLowerCase()).not.toContain('unauthorized')
        })

        it('does not look up any portfolios for an unlinked chat', async () => {
            const { handleStatusCommand } = await loadCommands()

            await handleStatusCommand(statusUpdate() as never)

            expect(mockGetUserPortfolios).not.toHaveBeenCalled()
        })

        it('gives instructions again after the chat is unlinked', async () => {
            const { handleStatusCommand, LINK_INSTRUCTIONS } = await loadCommands()
            const { linkChat, unlinkChat } = await loadLink()

            linkChat(String(CHAT_ID), USER)
            unlinkChat(String(CHAT_ID))

            const reply = await handleStatusCommand(statusUpdate() as never)
            expect(reply.text).toBe(LINK_INSTRUCTIONS)
        })
    })

    describe('linked chats', () => {
        beforeEach(async () => {
            const { linkChat } = await loadLink()
            linkChat(String(CHAT_ID), USER)
        })

        it('reports allocation, drift and last rebalance for the linked portfolios', async () => {
            const { handleStatusCommand } = await loadCommands()
            mockGetUserPortfolios.mockResolvedValue([portfolio()])

            const reply = await handleStatusCommand(statusUpdate() as never)

            expect(mockGetUserPortfolios).toHaveBeenCalledWith(USER)
            expect(reply.parseMode).toBe('Markdown')
            expect(reply.text).toContain('Portfolio Status')
            expect(reply.text).toContain('Core Portfolio')
            // 700/1000 = 70% actual against a 60% target.
            expect(reply.text).toContain('XLM: 70.0% / 60% target')
            expect(reply.text).toContain('USDC: 30.0% / 40% target')
            expect(reply.text).toContain('Max drift: 10.00%')
            expect(reply.text).toContain('Last rebalance: 2026-08-01 12:30 UTC')
        })

        it('flags a portfolio whose drift exceeds its threshold', async () => {
            const { handleStatusCommand } = await loadCommands()
            mockGetUserPortfolios.mockResolvedValue([portfolio()])

            const reply = await handleStatusCommand(statusUpdate() as never)

            expect(reply.text).toContain('Rebalance due')
        })

        it('marks a balanced portfolio as within threshold', async () => {
            const { handleStatusCommand } = await loadCommands()
            mockGetUserPortfolios.mockResolvedValue([
                portfolio({ balances: { XLM: 600, USDC: 400 } }),
            ])

            const reply = await handleStatusCommand(statusUpdate() as never)

            expect(reply.text).toContain('Within threshold')
            expect(reply.text).toContain('Max drift: 0.00%')
        })

        it('lists every linked portfolio', async () => {
            const { handleStatusCommand } = await loadCommands()
            mockGetUserPortfolios.mockResolvedValue([
                portfolio({ id: 'p1', name: 'Core' }),
                portfolio({ id: 'p2', name: 'Satellite' }),
            ])

            const reply = await handleStatusCommand(statusUpdate() as never)

            expect(reply.text).toContain('2 portfolios linked to this chat')
            expect(reply.text).toContain('Core')
            expect(reply.text).toContain('Satellite')
        })

        it('uses singular wording for one portfolio', async () => {
            const { handleStatusCommand } = await loadCommands()
            mockGetUserPortfolios.mockResolvedValue([portfolio()])

            const reply = await handleStatusCommand(statusUpdate() as never)

            expect(reply.text).toContain('1 portfolio linked to this chat')
        })

        it('handles a linked account with no portfolios yet', async () => {
            const { handleStatusCommand } = await loadCommands()
            mockGetUserPortfolios.mockResolvedValue([])

            const reply = await handleStatusCommand(statusUpdate() as never)

            expect(reply.text).toContain('No portfolios found')
            expect(reply.text).toContain('web app')
        })

        it('reports "never" when the portfolio has never rebalanced', async () => {
            const { handleStatusCommand } = await loadCommands()
            mockGetUserPortfolios.mockResolvedValue([portfolio({ lastRebalance: undefined })])

            const reply = await handleStatusCommand(statusUpdate() as never)

            expect(reply.text).toContain('Last rebalance: never')
        })

        it('degrades gracefully when the portfolio lookup fails', async () => {
            const { handleStatusCommand } = await loadCommands()
            mockGetUserPortfolios.mockRejectedValue(new Error('db down'))

            const reply = await handleStatusCommand(statusUpdate() as never)

            expect(reply.text).toContain('Could not load your portfolio status')
            expect(reply.text).not.toContain('db down')
        })

        it('answers per chat — another chat stays unlinked', async () => {
            const { handleStatusCommand, LINK_INSTRUCTIONS } = await loadCommands()
            mockGetUserPortfolios.mockResolvedValue([portfolio()])

            const other = await handleStatusCommand(statusUpdate(555) as never)

            expect(other.text).toBe(LINK_INSTRUCTIONS)
        })
    })

    describe('drift calculation', () => {
        it('returns the largest absolute gap across assets', async () => {
            const { computeMaxDrift } = await loadCommands()

            expect(computeMaxDrift(portfolio() as never)).toBeCloseTo(10, 6)
        })

        it('returns 0 for an empty or valueless portfolio', async () => {
            const { computeMaxDrift } = await loadCommands()

            expect(computeMaxDrift(portfolio({ totalValue: 0 }) as never)).toBe(0)
            expect(computeMaxDrift(portfolio({ allocations: {} }) as never)).toBe(0)
        })
    })

    describe('link persistence', () => {
        it('stores the link so it survives a fresh lookup', async () => {
            const { linkChat, getLinkedAddress, resetTelegramLinksForTests } = await loadLink()

            linkChat(String(CHAT_ID), USER)
            // Drop the in-memory mirror; the value must come back from the kv store.
            resetTelegramLinksForTests()

            expect(getLinkedAddress(String(CHAT_ID))).toBe(USER)
        })

        it('reports no address for a chat that was never linked', async () => {
            const { getLinkedAddress } = await loadLink()

            expect(getLinkedAddress('does-not-exist')).toBeUndefined()
        })
    })
})
