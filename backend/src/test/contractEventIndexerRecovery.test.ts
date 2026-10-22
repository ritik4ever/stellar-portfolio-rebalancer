import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contractEventIndexerService as indexer } from '../services/contractEventIndexer.js'
import { databaseService } from '../services/databaseService.js'
import { BACKEND_CONTRACT_EVENT_SCHEMA_VERSION } from '../config/contractEventSchema.js'

vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        getIndexerState: vi.fn(), setIndexerState: vi.fn(),
        ensurePortfolioExists: vi.fn(), recordRebalanceEvent: vi.fn(),
    },
}))
vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const CURSOR = 'soroban_event_indexer.cursor'
const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEWCEUNYQZ2QZ2QZ2QZ2QZ2QZ2QZ2Q'
const event = (pagingToken: string, txHash = pagingToken) => ({
    contractId: CONTRACT, topic: ['portfolio', 'rebalance_executed'],
    value: ['portfolio-1', 'user-1'], ledger: 1000,
    ledgerClosedAt: '2026-10-22T00:00:00Z', txHash, pagingToken,
})
const page = (...events: ReturnType<typeof event>[]) => ({ events, latestLedger: 1000 })

describe('contract event replay recovery (#2101)', () => {
    const rpc = { getLatestLedger: vi.fn(), getEvents: vi.fn() }
    let state: Map<string, string>

    beforeEach(() => {
        vi.resetAllMocks()
        vi.stubEnv('CONTRACT_EVENT_SCHEMA_VERSION', String(BACKEND_CONTRACT_EVENT_SCHEMA_VERSION))
        Object.assign(indexer, { contractAddress: CONTRACT, rpcUrl: 'http://localhost:8000',
            rpcServer: rpc, consecutiveFailures: 0, recentErrors: [] })
        ;(indexer as any).seenEventKeys.clear()
        ;(indexer as any).status = {}
        vi.spyOn(indexer as any, 'safeScValToNative').mockImplementation((value) => value)
        state = new Map()
        vi.mocked(databaseService.getIndexerState).mockImplementation((key) => state.get(key))
        vi.mocked(databaseService.setIndexerState).mockImplementation((key, value) => { state.set(key, value) })
        rpc.getLatestLedger.mockResolvedValue({ sequence: 1000 })
        rpc.getEvents.mockResolvedValue(page())
    })

    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

    it('retries an unwritten event without repeating a successful write after a partial-page failure', async () => {
        const recorded: string[] = []
        let fail = true
        vi.mocked(databaseService.recordRebalanceEvent).mockImplementation((data) => {
            if (data.onChainPagingToken === 'b' && fail) {
                fail = false
                throw new Error('temporary database failure')
            }
            recorded.push(data.onChainPagingToken!)
            return { id: data.onChainPagingToken } as any
        })
        rpc.getEvents.mockResolvedValueOnce(page(event('a'), event('b')))
        await indexer.syncOnce()
        expect(recorded).toEqual(['a'])
        expect(state.get(CURSOR)).toBeUndefined()
        expect(indexer.getStatus().lastError).toContain('temporary database failure')

        rpc.getEvents.mockResolvedValueOnce(page(event('a'), event('b')))
        await indexer.syncOnce()
        expect(recorded).toEqual(['a', 'b'])
        expect(state.get(CURSOR)).toBe('b')
        expect(indexer.getStatus().lastError).toBeUndefined()
    })

    it('stops a repeated page with a diagnostic and resumes from the last completed page', async () => {
        rpc.getEvents.mockResolvedValue(page(event('a')))
        await indexer.syncOnce()
        expect(rpc.getEvents).toHaveBeenCalledTimes(2)
        expect(databaseService.recordRebalanceEvent).toHaveBeenCalledTimes(1)
        expect(state.get(CURSOR)).toBe('a')
        expect(indexer.getStatus().lastError).toContain('INDEXER_CURSOR_STALLED')
        expect(indexer.getStatus().consecutiveFailures).toBe(1)

        rpc.getEvents.mockResolvedValueOnce(page(event('b'))).mockResolvedValue(page())
        await indexer.syncOnce()
        expect(rpc.getEvents.mock.calls[2][0].cursor).toBe('a')
        expect(databaseService.recordRebalanceEvent).toHaveBeenCalledTimes(2)
        expect(state.get(CURSOR)).toBe('b')
        expect(indexer.getStatus().lastError).toBeUndefined()
    })

    it('stops a cursor cycle before consuming the page budget or rewinding progress', async () => {
        rpc.getEvents.mockResolvedValueOnce(page(event('a')))
            .mockResolvedValueOnce(page(event('b'))).mockResolvedValue(page(event('a')))
        await indexer.syncOnce()
        expect(rpc.getEvents).toHaveBeenCalledTimes(3)
        expect(databaseService.recordRebalanceEvent).toHaveBeenCalledTimes(2)
        expect(state.get(CURSOR)).toBe('b')
        expect(indexer.getStatus().lastError).toContain('INDEXER_CURSOR_STALLED')
    })

    it('rejects a nonempty page without a resume token before writing it', async () => {
        rpc.getEvents.mockResolvedValue(page(event('')))
        await indexer.syncOnce()
        expect(rpc.getEvents).toHaveBeenCalledTimes(1)
        expect(databaseService.recordRebalanceEvent).not.toHaveBeenCalled()
        expect(state.get(CURSOR)).toBeUndefined()
        expect(indexer.getStatus().lastError).toContain('INDEXER_CURSOR_MISSING')
    })

    it('keeps distinct event tokens in the same transaction and portfolio', async () => {
        rpc.getEvents.mockResolvedValueOnce(page(event('a', 'same-tx'), event('b', 'same-tx')))
        await indexer.syncOnce()
        expect(databaseService.recordRebalanceEvent).toHaveBeenCalledTimes(2)
    })
})
