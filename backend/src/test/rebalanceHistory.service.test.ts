import { describe, it, expect, vi, beforeEach } from 'vitest'

const recordMock = vi.fn()
const getHistoryMock = vi.fn()
const getRecentAutoMock = vi.fn()
const getCostSummaryMock = vi.fn()
const loggerMocks = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
}))

vi.mock('../utils/logger.js', () => ({
    logger: loggerMocks,
}))

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
        loggerMocks.info.mockReset()
        loggerMocks.warn.mockReset()
        loggerMocks.error.mockReset()
    })

    it('records enriched rebalance events with derived details', async () => {
        recordMock.mockImplementation((event) => {
            const { randomUUID } = require('node:crypto')
            return {
                id: 'evt-1',
                portfolioId: event.portfolioId,
                timestamp: (event.timestamp instanceof Date ? event.timestamp : new Date()).toISOString(),
                trigger: event.trigger,
                trades: event.trades,
                gasUsed: event.gasUsed,
                feePaid: event.feePaid ?? 0,
                slippageBps: event.slippageBps ?? 0,
                status: event.status,
                isAutomatic: event.isAutomatic ?? false,
                riskAlerts: event.riskAlerts ?? [],
                error: event.error,
                actor: event.actor,
                source: event.source,
                triggerMetadata: event.triggerMetadata,
                eventSource: event.eventSource,
                onChainConfirmed: event.onChainConfirmed,
                onChainEventType: event.onChainEventType,
                onChainTxHash: event.onChainTxHash,
                onChainLedger: event.onChainLedger,
                onChainContractId: event.onChainContractId,
                onChainPagingToken: event.onChainPagingToken,
                isSimulated: event.isSimulated,
                details: event.details,
            }
        })

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

    it('records a safe successful persistence outcome', async () => {
        recordMock.mockImplementation((event) => ({ id: 'evt-success', ...event }))
        const { RebalanceHistoryService } = await import('../services/rebalanceHistory.js')
        const service = new RebalanceHistoryService()

        await service.recordRebalanceEvent({
            portfolioId: 'private-portfolio-success',
            trigger: 'Manual Rebalancing',
            trades: 1,
            gasUsed: '0.01 XLM',
            status: 'completed',
            persistenceContext: {
                source: 'api',
                stateTransition: 'committed',
            },
        })

        expect(loggerMocks.info).toHaveBeenCalledWith(
            '[REBALANCE-HISTORY] Recorded rebalance event',
            expect.objectContaining({
                source: 'api',
                outcome: 'success',
                eventStatus: 'completed',
                stateTransition: 'committed',
            }),
        )
        expect(JSON.stringify(loggerMocks.info.mock.calls)).not.toContain('private-portfolio-success')
    })

    it('reports a retryable history write failure as delayed without logging the error message', async () => {
        const secretDatabaseMessage = 'password=do-not-log database unavailable'
        recordMock.mockRejectedValueOnce(Object.assign(new Error(secretDatabaseMessage), { code: '08006' }))
        const { RebalanceHistoryService } = await import('../services/rebalanceHistory.js')
        const service = new RebalanceHistoryService()

        await expect(service.recordRebalanceEvent({
            portfolioId: 'private-portfolio-delayed',
            trigger: 'Automatic Rebalancing',
            trades: 1,
            gasUsed: '0.01 XLM',
            status: 'completed',
            persistenceContext: {
                source: 'worker',
                retryAvailable: true,
                stateTransition: 'committed',
            },
        })).rejects.toThrow(secretDatabaseMessage)

        expect(loggerMocks.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: 'record_rebalance_event',
                source: 'worker',
                outcome: 'delayed',
                eventStatus: 'completed',
                stateTransition: 'committed',
                retryAvailable: true,
                databaseErrorCode: '08006',
            }),
            'Portfolio persistence write delayed',
        )
        expect(JSON.stringify(loggerMocks.warn.mock.calls)).not.toContain(secretDatabaseMessage)
        expect(JSON.stringify(loggerMocks.warn.mock.calls)).not.toContain('private-portfolio-delayed')

        const { getMetricsPayload } = await import('../observability/metrics.js')
        const metricLines = (await getMetricsPayload()).split('\n')
        expect(metricLines.some((line) =>
            line.includes('portfolio_persistence_outcomes_total{')
            && line.includes('source="worker"')
            && line.includes('outcome="delayed"')
            && line.includes('event_status="completed"')
            && line.includes('state_transition="committed"')
            && line.endsWith(' 1'),
        )).toBe(true)
    })

    it('reports a non-retryable persistence failure as blocked with bounded diagnostics', async () => {
        recordMock.mockRejectedValueOnce(new Error('internal details must not be logged'))
        const { RebalanceHistoryService } = await import('../services/rebalanceHistory.js')
        const service = new RebalanceHistoryService()

        await expect(service.recordRebalanceEvent({
            portfolioId: 'private-portfolio-blocked',
            trigger: 'Manual Rebalancing',
            trades: 0,
            gasUsed: '0 XLM',
            status: 'failed',
            persistenceContext: {
                source: 'api',
                retryAvailable: false,
                stateTransition: 'unknown',
            },
        })).rejects.toThrow('internal details must not be logged')

        expect(loggerMocks.error).toHaveBeenCalledWith(
            expect.objectContaining({
                source: 'api',
                outcome: 'blocked',
                eventStatus: 'failed',
                stateTransition: 'unknown',
                retryAvailable: false,
                databaseErrorCode: 'unknown',
            }),
            'Portfolio persistence write blocked',
        )
        expect(JSON.stringify(loggerMocks.error.mock.calls)).not.toContain('internal details must not be logged')
        expect(JSON.stringify(loggerMocks.error.mock.calls)).not.toContain('private-portfolio-blocked')
    })
})
