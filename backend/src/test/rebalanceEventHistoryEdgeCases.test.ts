import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BACKEND_CONTRACT_EVENT_SCHEMA_VERSION } from '../config/contractEventSchema.js'

// #2104: the indexer is exercised against a private SQLite file and a stubbed
// RPC so both edge cases (two events in one ledger, and a replayed page) are
// reproducible on every run instead of depending on a live chain.
const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEWCEUNYQZ2QZ2QZ2QZ2QZ2QZ2QZ2Q'
const LEDGER = 1000
const LEDGER_CLOSED_AT = '2026-10-22T00:00:00Z'
const PORTFOLIO_ID = 'portfolio-history-1'

// Both events are confirmed in the same ledger, so they share the ledger close
// timestamp and only the paging token can order them.
const TOKEN_A = '0000001000-0000000000000001-0000000000000000'
const TOKEN_B = '0000001000-0000000000000002-0000000000000000'

const chainEvent = (pagingToken: string, txHash: string) => ({
    contractId: CONTRACT,
    topic: ['portfolio', 'rebalance_executed'],
    value: [PORTFOLIO_ID, 'user-1'],
    ledger: LEDGER,
    ledgerClosedAt: LEDGER_CLOSED_AT,
    txHash,
    pagingToken,
})

// The suite owns these variables while it runs; other suites in the same
// worker must not inherit them.
const MANAGED_ENV = ['DB_PATH', 'ENABLE_DEMO_DB_SEED', 'DEMO_MODE', 'CONTRACT_EVENT_SCHEMA_VERSION'] as const
const originalEnv = new Map<string, string | undefined>(
    MANAGED_ENV.map((key) => [key, process.env[key]]),
)

const restoreEnv = () => {
    for (const key of MANAGED_ENV) {
        const original = originalEnv.get(key)
        if (original === undefined) delete process.env[key]
        else process.env[key] = original
    }
}

describe('rebalance event history edge cases (#2104)', () => {
    let databaseService: typeof import('../services/databaseService.js')['databaseService']
    let contractEventIndexerService: typeof import('../services/contractEventIndexer.js')['contractEventIndexerService']

    const rpc = {
        getLatestLedger: vi.fn(async () => ({ sequence: LEDGER })),
        getEvents: vi.fn(),
    }

    // The cursor checkpoint lives outside the history table, so it is stubbed to
    // keep the replay scenario independent of the previous run.
    let indexerState: Map<string, string>
    let dbDirs: string[] = []

    beforeEach(async () => {
        // Every test gets its own database file and its own service instances so
        // no test can observe rows written by another one.
        vi.resetModules()
        const dbDir = join(tmpdir(), `rebalance-history-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(dbDir, { recursive: true })
        dbDirs.push(dbDir)
        process.env.DB_PATH = join(dbDir, 'portfolio.db')
        process.env.ENABLE_DEMO_DB_SEED = 'false'
        process.env.DEMO_MODE = 'false'
        process.env.CONTRACT_EVENT_SCHEMA_VERSION = String(BACKEND_CONTRACT_EVENT_SCHEMA_VERSION)

        ;({ databaseService } = await import('../services/databaseService.js'))
        ;({ contractEventIndexerService } = await import('../services/contractEventIndexer.js'))

        indexerState = new Map()
        ;(contractEventIndexerService as any).contractAddress = CONTRACT
        ;(contractEventIndexerService as any).rpcUrl = 'http://localhost:8000'
        ;(contractEventIndexerService as any).rpcServer = rpc
        ;(contractEventIndexerService as any).seenEventKeys.clear()
        ;(contractEventIndexerService as any).status = {}

        vi.spyOn(contractEventIndexerService as any, 'safeScValToNative').mockImplementation(
            (value: unknown) => value,
        )
        vi.spyOn(databaseService, 'getIndexerState').mockImplementation((key: string) => indexerState.get(key))
        vi.spyOn(databaseService, 'setIndexerState').mockImplementation((key: string, value: string) => {
            indexerState.set(key, value)
        })

        rpc.getLatestLedger.mockReset()
        rpc.getLatestLedger.mockResolvedValue({ sequence: LEDGER })
        rpc.getEvents.mockReset()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        restoreEnv()
        try {
            databaseService.close()
        } catch {
            // The handle may already be released when the suite failed early.
        }
    })

    afterAll(() => {
        restoreEnv()
        for (const dbDir of dbDirs) {
            try {
                rmSync(dbDir, { recursive: true, force: true })
            } catch {
                // Windows may briefly hold the SQLite file open; the temp directory is disposable.
            }
        }
    })

    /** One page holding both same-ledger events, then an empty terminal page. */
    const pageWithBothEvents = () => {
        rpc.getEvents.mockResolvedValueOnce({
            events: [chainEvent(TOKEN_A, 'tx-a'), chainEvent(TOKEN_B, 'tx-b')],
            latestLedger: LEDGER,
        })
        rpc.getEvents.mockResolvedValue({ events: [], latestLedger: LEDGER })
    }

    const history = () => databaseService.getRebalanceHistory(PORTFOLIO_ID, 10)

    describe('two events in one ledger', () => {
        it('records both events once and orders them deterministically', async () => {
            pageWithBothEvents()

            const result = await contractEventIndexerService.syncOnce()

            expect(result.ingested).toBe(2)

            const recorded = history()
            expect(recorded).toHaveLength(2)
            expect(new Set(recorded.map((event) => event.id)).size).toBe(2)
            expect(recorded.map((event) => event.onChainPagingToken).sort()).toEqual([TOKEN_A, TOKEN_B])

            // Same ledger close time, so the order is decided by the paging token.
            expect(recorded[0].timestamp).toBe(LEDGER_CLOSED_AT)
            expect(recorded[1].timestamp).toBe(LEDGER_CLOSED_AT)
            expect(recorded.map((event) => event.onChainPagingToken)).toEqual([TOKEN_B, TOKEN_A])
        })

        it('returns the same order on every read', async () => {
            pageWithBothEvents()
            await contractEventIndexerService.syncOnce()

            const first = history()
            const second = history()
            const unscoped = databaseService.getRebalanceHistory(undefined, 10)

            expect(second.map((event) => event.id)).toEqual(first.map((event) => event.id))
            expect(unscoped.map((event) => event.id)).toEqual(first.map((event) => event.id))
        })
    })

    describe('indexer replaying a previously recorded page', () => {
        it('does not duplicate events or report the replay as ingested work', async () => {
            pageWithBothEvents()
            const first = await contractEventIndexerService.syncOnce()
            expect(first.ingested).toBe(2)

            const recordedIds = history().map((event) => event.id)
            const recordedTimestamps = history().map((event) => event.timestamp)
            expect(recordedIds).toHaveLength(2)

            // Restart the indexer: the in-memory dedup cache and the persisted
            // cursor are gone, so the very same page is delivered again.
            ;(contractEventIndexerService as any).seenEventKeys.clear()
            indexerState.clear()
            pageWithBothEvents()

            const replay = await contractEventIndexerService.syncOnce()

            expect(replay.ingested).toBe(0)
            expect(contractEventIndexerService.getStatus().lastIngestedCount).toBe(0)

            const afterReplay = history()
            expect(afterReplay).toHaveLength(2)
            expect(afterReplay.map((event) => event.id)).toEqual(recordedIds)
            expect(afterReplay.map((event) => event.timestamp)).toEqual(recordedTimestamps)
            expect(new Set(afterReplay.map((event) => event.onChainPagingToken)).size).toBe(2)
        })

        it('keeps the original row when the replayed page is written again', async () => {
            pageWithBothEvents()
            await contractEventIndexerService.syncOnce()

            const original = history().find((event) => event.onChainPagingToken === TOKEN_A)
            expect(original).toBeDefined()

            ;(contractEventIndexerService as any).seenEventKeys.clear()
            indexerState.clear()
            pageWithBothEvents()
            await contractEventIndexerService.syncOnce()

            const afterReplay = history().find((event) => event.onChainPagingToken === TOKEN_A)
            expect(afterReplay?.id).toBe(original?.id)
            expect(afterReplay?.timestamp).toBe(original?.timestamp)
            expect(afterReplay?.onChainTxHash).toBe(original?.onChainTxHash)
        })
    })
})
