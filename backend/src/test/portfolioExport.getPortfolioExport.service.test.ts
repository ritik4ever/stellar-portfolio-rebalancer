import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Portfolio } from '../types/index.js'
import type { RebalanceEvent } from '../services/rebalanceHistory.js'

const mocks = vi.hoisted(() => ({
    mockPortfolioStorage: {
        getPortfolio: vi.fn(),
    },
    mockRebalanceHistoryService: {
        getRebalanceHistory: vi.fn(),
    },
    mockGetCurrentPrices: vi.fn(),
}))

vi.mock('../services/portfolioStorage.js', () => ({
    portfolioStorage: mocks.mockPortfolioStorage
}))

vi.mock('../services/serviceContainer.js', () => ({
    rebalanceHistoryService: mocks.mockRebalanceHistoryService
}))

vi.mock('../services/reflector.js', () => ({
    ReflectorService: class {
        getCurrentPrices = mocks.mockGetCurrentPrices
    }
}))

vi.mock('../utils/logger.js', () => ({
    logger: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }
}))

import { getPortfolioExport } from '../services/portfolioExportService.js'

const portfolio: Portfolio = {
    id: 'abc12345-0000-0000-0000-000000000001',
    userAddress: 'GUSER1234567890ABCDEFG',
    allocations: { XLM: 50, USDC: 50 },
    threshold: 5,
    balances: { XLM: 100, USDC: 100 },
    totalValue: 200,
    createdAt: '2024-01-01T00:00:00.000Z',
    lastRebalance: '2024-01-02T00:00:00.000Z',
    version: 1
}

const history: RebalanceEvent[] = [
    {
        id: 'evt-1',
        portfolioId: portfolio.id,
        timestamp: '2024-01-03T00:00:00.000Z',
        trigger: 'threshold',
        trades: 1,
        gasUsed: '0.001',
        status: 'completed',
        isAutomatic: true
    }
]

describe('getPortfolioExport', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'))
        mocks.mockPortfolioStorage.getPortfolio.mockResolvedValue(portfolio)
        mocks.mockRebalanceHistoryService.getRebalanceHistory.mockResolvedValue(history)
        mocks.mockGetCurrentPrices.mockResolvedValue({ XLM: { price: 0.1 }, USDC: { price: 1 } })
    })

    it('returns null for missing portfolio', async () => {
        mocks.mockPortfolioStorage.getPortfolio.mockResolvedValueOnce(null)
        const result = await getPortfolioExport('missing-portfolio', 'json')
        expect(result).toBeNull()
    })

    it('returns stable JSON content type and filename pattern', async () => {
        const result = await getPortfolioExport(portfolio.id, 'json')
        expect(result).not.toBeNull()
        expect(result!.contentType).toBe('application/json; charset=utf-8')
        expect(result!.filename).toMatch(/^portfolio-[0-9a-z-]{8}-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/)
    })

    it('returns stable CSV content type and filename pattern', async () => {
        const result = await getPortfolioExport(portfolio.id, 'csv')
        expect(result).not.toBeNull()
        expect(result!.contentType).toBe('text/csv; charset=utf-8')
        expect(result!.filename).toMatch(/^portfolio-[0-9a-z-]{8}-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/)
    })

    it('returns stable PDF content type and filename pattern', async () => {
        const result = await getPortfolioExport(portfolio.id, 'pdf')
        expect(result).not.toBeNull()
        expect(result!.contentType).toBe('application/pdf')
        expect(result!.filename).toMatch(/^portfolio-[0-9a-z-]{8}-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.pdf$/)
    })

    it('returns null for invalid export format', async () => {
        const result = await getPortfolioExport(portfolio.id, 'xlsx' as 'json')
        expect(result).toBeNull()
    })
})
