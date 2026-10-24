import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryMock = vi.fn()
vi.mock('../db/client.js', () => ({ query: queryMock }))

describe('rebalanceHistoryDb (Postgres)', () => {
    beforeEach(() => {
        queryMock.mockReset()
    })

    it('inserts with full column set and returns the persisted row', async () => {
        const row = {
            id: 'e1',
            portfolio_id: 'p1',
            timestamp: new Date('2026-01-01T00:00:00Z'),
            trigger: 't',
            trades: 1,
            gas_used: '0 XLM',
            fee_paid: 0.01,
            slippage_bps: 5,
            status: 'completed',
            is_automatic: true,
            event_source: 'offchain',
            on_chain_confirmed: false,
            on_chain_event_type: null,
            on_chain_tx_hash: null,
            on_chain_ledger: null,
            on_chain_contract_id: null,
            on_chain_paging_token: null,
            is_simulated: false,
            risk_alerts: [],
            error: null,
            details: { actor: 'user', source: 'dashboard', reason: 'x', feePaid: 0.01, slippageBps: 5 },
        }
        queryMock.mockResolvedValueOnce({ rows: [row] })
        const { dbInsertRebalanceEvent } = await import('../db/rebalanceHistoryDb.js')
        const res = await dbInsertRebalanceEvent({
            portfolioId: 'p1',
            trigger: 't',
            trades: 1,
            gasUsed: '0 XLM',
            status: 'completed',
            isAutomatic: true,
            actor: 'user',
            source: 'dashboard',
        })
        expect(res.id).toBe('e1')
        expect(res.actor).toBe('user')
        expect(res.source).toBe('dashboard')
        expect(res.timestamp).toBe('2026-01-01T00:00:00.000Z')
        const sql = queryMock.mock.calls[0][0]
        expect(sql).toContain('RETURNING *')
        expect(sql).toContain('ON CONFLICT DO NOTHING')
        expect(sql).toContain('fee_paid')
        expect(sql).toContain('event_source')
        expect(sql).toContain('on_chain_paging_token')
    })

    it('on conflict returns existing row without duplicate insert', async () => {
        queryMock.mockResolvedValueOnce({ rows: [] })
        const existing = {
            id: 'e2',
            portfolio_id: 'p1',
            timestamp: new Date('2026-01-01T01:00:00Z'),
            trigger: 't',
            trades: 1,
            gas_used: '0 XLM',
            fee_paid: 0,
            slippage_bps: 0,
            status: 'failed',
            is_automatic: false,
            event_source: 'api',
            on_chain_confirmed: false,
            on_chain_event_type: null,
            on_chain_tx_hash: null,
            on_chain_ledger: null,
            on_chain_contract_id: null,
            on_chain_paging_token: null,
            is_simulated: false,
            risk_alerts: [],
            error: 'boom',
            details: {},
        }
        queryMock.mockResolvedValueOnce({ rows: [existing] })
        const { dbInsertRebalanceEvent } = await import('../db/rebalanceHistoryDb.js')
        const res = await dbInsertRebalanceEvent({ id: 'e2', portfolioId: 'p1', trigger: 't', trades: 1, gasUsed: '0', status: 'failed', isAutomatic: false, error: 'boom' })
        expect(res.id).toBe('e2')
        expect(res.status).toBe('failed')
        expect(res.error).toBe('boom')
        expect(queryMock).toHaveBeenCalledTimes(2)
    })

    it('orders by timestamp desc then id desc', async () => {
        queryMock.mockResolvedValueOnce({ rows: [] })
        const { dbGetRebalanceHistoryByPortfolio } = await import('../db/rebalanceHistoryDb.js')
        await dbGetRebalanceHistoryByPortfolio('p1', 10, 0)
        expect(queryMock.mock.calls[0][0]).toMatch(/ORDER BY timestamp DESC, id DESC/)
    })
})
