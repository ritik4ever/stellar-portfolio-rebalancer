import { describe, it, expect, vi, beforeEach } from 'vitest'

const recordMock = vi.fn()
const getHistoryMock = vi.fn()
const getRecentAutoMock = vi.fn()

vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        recordRebalanceEvent: recordMock,
        getRebalanceHistory: getHistoryMock,
        getRecentAutoRebalances: getRecentAutoMock,
        getAutoRebalancesSince: vi.fn(),
        getAllAutoRebalances: vi.fn(),
        initializeDemoData: vi.fn(),
        clearHistory: vi.fn(),
        getHistoryStats: vi.fn()
    }
}))

describe('RebalanceHistoryService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('records enriched rebalance events with derived details', async () => {
        recordMock.mockImplementation((event) => ({ id: 'evt-1', ...event }))

        const { RebalanceHistoryService } = await import('../services/rebalanceHistory.js')
        const service = new RebalanceHistoryService({
            analyzePortfolioRisk: vi.fn(() => ({ overallRiskLevel: 'medium' }))
        } as any)

        const event = await service.recordRebalanceEvent({
            portfolioId: 'p1',
            trigger: 'Threshold exceeded (8.2%)',
            trades: 2,
            gasUsed: '0.02 XLM',
            status: 'completed',
            isAutomatic: true,
            actor: 'scheduler',
            source: 'auto_rebalance',
            triggerMetadata: { driftPct: 8.2, thresholdPct: 5 },
            portfolio: { allocations: { XLM: 50, BTC: 50 } },
            prices: {
                XLM: { price: 0.1, change: -2, timestamp: 1 },
                BTC: { price: 100, change: 1, timestamp: 1 }
            }
        })

        expect(event.id).toBe('evt-1')
        expect(recordMock).toHaveBeenCalledOnce()
        const saved = recordMock.mock.calls[0][0]
        expect(saved.details.reason).toMatch(/drift exceeded/i)
        expect(saved.details.riskLevel).toBe('medium')
        expect(saved.details.priceDirection).toMatch(/up|down/)
        expect(saved.actor).toBe('scheduler')
        expect(saved.source).toBe('auto_rebalance')
        expect(saved.triggerMetadata).toEqual({ driftPct: 8.2, thresholdPct: 5 })
    })

    it('infers actor/source from isAutomatic when not provided', async () => {
        recordMock.mockImplementation((event) => ({ id: 'evt-2', ...event }))

        const { RebalanceHistoryService } = await import('../services/rebalanceHistory.js')
        const service = new RebalanceHistoryService({
            analyzePortfolioRisk: vi.fn(() => ({ overallRiskLevel: 'low' }))
        } as any)

        await service.recordRebalanceEvent({
            portfolioId: 'p2',
            trigger: 'Manual Rebalance',
            trades: 1,
            gasUsed: '0.01 XLM',
            status: 'completed',
            isAutomatic: false,
        })

        const saved = recordMock.mock.calls[0][0]
        expect(saved.actor).toBe('user')
        expect(saved.source).toBe('dashboard')
    })

    it('proxies history query calls', async () => {
        getHistoryMock.mockReturnValue([{ id: 'e1' }])
        getRecentAutoMock.mockReturnValue([{ id: 'e2' }])

        const { RebalanceHistoryService } = await import('../services/rebalanceHistory.js')
        const service = new RebalanceHistoryService({
            analyzePortfolioRisk: vi.fn(() => ({ overallRiskLevel: 'medium' }))
        } as any)

        const history = await service.getRebalanceHistory('p1', 20)
        const auto = await service.getRecentAutoRebalances('p1', 10)

        expect(history).toEqual([{ id: 'e1' }])
        expect(auto).toEqual([{ id: 'e2' }])
        expect(getHistoryMock).toHaveBeenCalledWith('p1', 20, {})
        expect(getRecentAutoMock).toHaveBeenCalledWith('p1', 10)
    })
})
