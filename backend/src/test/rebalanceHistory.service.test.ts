import { describe, it, expect, vi, beforeEach } from 'vitest'

const recordMock = vi.fn()
const getHistoryMock = vi.fn()
const getRecentAutoMock = vi.fn()
const getCostSummaryMock = vi.fn()

vi.mock('../services/riskManagements.js', () => ({
    RiskManagementService: class {
        analyzePortfolioRisk() {
            return { overallRiskLevel: 'low' }
        }
    },
}))

vi.mock('../db/rebalanceHistoryDb.js', () => ({
    dbInsertRebalanceEvent: recordMock,
    dbGetRebalanceHistoryByPortfolio: getHistoryMock,
    dbGetRebalanceHistoryAll: vi.fn(),
    dbGetRecentAutoRebalances: getRecentAutoMock,
    dbGetAutoRebalancesSince: vi.fn(),
    dbGetAllAutoRebalances: vi.fn(),
    dbGetHistoryStats: vi.fn(),
    dbGetRebalanceHistoryCountByPortfolio: vi.fn(),
    dbGetRebalanceCostSummary: getCostSummaryMock,
}))

describe('RebalanceHistoryService', () => {
    beforeEach(() => {
        recordMock.mockReset()
        getHistoryMock.mockReset()
        getRecentAutoMock.mockReset()
        getCostSummaryMock.mockReset()
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
            gasBreakdown: [
                { tradeId: 'trade-1', feeXlm: 0.01 },
                { tradeId: 'trade-2', feeXlm: 0.02 },
            ],
            actualSlippageBps: 14,
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
        expect(saved.feePaid).toBeCloseTo(0.03)
        expect(saved.slippageBps).toBe(14)
        expect(saved.details.priceDirection).toMatch(/up|down/)
        expect(saved.actor).toBe('scheduler')
        expect(saved.source).toBe('auto_rebalance')
        expect(saved.triggerMetadata).toEqual({ driftPct: 8.2, thresholdPct: 5 })
    }, 15000)

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

    it('proxies history and cost summary query calls', async () => {
        getHistoryMock.mockReturnValue([{ id: 'e1' }])
        getRecentAutoMock.mockReturnValue([{ id: 'e2' }])
        getCostSummaryMock.mockResolvedValue({
            total_fees_paid: 0.05,
            avg_slippage_bps: 12.5,
            cost_per_rebalance: 0.025,
            total_rebalances: 2,
        })

        const { RebalanceHistoryService } = await import('../services/rebalanceHistory.js')
        const service = new RebalanceHistoryService({
            analyzePortfolioRisk: vi.fn(() => ({ overallRiskLevel: 'medium' }))
        } as any)

        const history = await service.getRebalanceHistory('p1', 20)
        const auto = await service.getRecentAutoRebalances('p1', 10)
        const costSummary = await service.getCostSummary('p1')

        expect(history).toEqual([{ id: 'e1' }])
        expect(auto).toEqual([{ id: 'e2' }])
        expect(costSummary).toEqual({
            total_fees_paid: 0.05,
            avg_slippage_bps: 12.5,
            cost_per_rebalance: 0.025,
            total_rebalances: 2,
        })
        expect(getHistoryMock).toHaveBeenCalledWith('p1', 20, 0)
        expect(getRecentAutoMock).toHaveBeenCalledWith('p1', 10)
        expect(getCostSummaryMock).toHaveBeenCalledWith('p1')
    })
})
