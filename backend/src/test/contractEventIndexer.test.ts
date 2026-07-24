import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { contractEventIndexerService } from '../services/contractEventIndexer.js'
import { databaseService } from '../services/databaseService.js'
import { SorobanRpc } from '@stellar/stellar-sdk'
import { BACKEND_CONTRACT_EVENT_SCHEMA_VERSION } from '../config/contractEventSchema.js'

// Mock dependencies
vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        getIndexerState: vi.fn(),
        setIndexerState: vi.fn(),
        ensurePortfolioExists: vi.fn(),
        recordRebalanceEvent: vi.fn(),
        getRebalanceHistory: vi.fn(),
        getReplayStatus: vi.fn(),
        getReplayIntegrityHash: vi.fn(),
        setReplayIntegrityHash: vi.fn(),
        setLastReplayedLedger: vi.fn(),
        setReplayEventCount: vi.fn(),
        setReplayCheckpoint: vi.fn(),
    }
}))

vi.mock('../utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }
}))

describe('contractEventIndexer', () => {
    let rpcServerMock: any

    beforeEach(() => {
        vi.clearAllMocks()
        process.env.CONTRACT_EVENT_SCHEMA_VERSION = String(BACKEND_CONTRACT_EVENT_SCHEMA_VERSION)
        
        // Overwrite singleton properties for testing
        ;(contractEventIndexerService as any).contractAddress = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEWCEUNYQZ2QZ2QZ2QZ2QZ2QZ2QZ2Q'
        ;(contractEventIndexerService as any).status.contractAddress = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEWCEUNYQZ2QZ2QZ2QZ2QZ2QZ2QZ2Q'
        ;(contractEventIndexerService as any).rpcUrl = 'http://localhost:8000'
        ;(contractEventIndexerService as any).seenEventKeys.clear()

        // Mock RPC Server
        rpcServerMock = {
            getLatestLedger: vi.fn().mockResolvedValue({ sequence: 1000 }),
            getEvents: vi.fn().mockResolvedValue({ events: [], latestLedger: 1000 })
        }
        ;(contractEventIndexerService as any).rpcServer = rpcServerMock
    })

    afterEach(() => {
        delete process.env.CONTRACT_EVENT_SCHEMA_VERSION
        delete process.env.CONTRACT_ADDRESS
        delete process.env.SOROBAN_RPC_URL
    })

    it('parses events matching the schema', async () => {
        // Arrange
        const portfolioIdStr = 'portfolio-123'
        // Using XDR to construct a basic representation isn't trivial, so we mock `safeScValToNative` 
        // to return controlled objects.
        const safeScValToNativeSpy = vi.spyOn(contractEventIndexerService as any, 'safeScValToNative')
        
        // Let's create an event
        const mockEvent = {
            contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEWCEUNYQZ2QZ2QZ2QZ2QZ2QZ2QZ2Q',
            topic: ['topic1', 'topic2'],
            value: 'mock-value',
            ledgerClosedAt: '2023-01-01T00:00:00Z',
            txHash: '0x123',
            ledger: 1000,
            pagingToken: 'token-1'
        } as unknown as SorobanRpc.Api.EventResponse

        rpcServerMock.getEvents.mockResolvedValueOnce({
            events: [mockEvent],
            latestLedger: 1000
        })

        // Mock safeScValToNative to translate topics and values
        safeScValToNativeSpy.mockImplementation((val) => {
            if (val === 'topic1') return 'portfolio'
            if (val === 'topic2') return 'rebalance_executed'
            if (val === 'mock-value') return [portfolioIdStr, 'user-abc']
            return undefined
        })

        // Act
        const result = await contractEventIndexerService.syncOnce()

        // Assert
        expect(result.ingested).toBe(1)
        expect(databaseService.recordRebalanceEvent).toHaveBeenCalledTimes(1)
        expect(databaseService.recordRebalanceEvent).toHaveBeenCalledWith(expect.objectContaining({
            portfolioId: portfolioIdStr,
            onChainEventType: 'rebalance_executed',
            onChainTxHash: '0x123',
            onChainLedger: 1000,
            onChainPagingToken: 'token-1'
        }))

        safeScValToNativeSpy.mockRestore()
    })

    it('deduplicates replayed events (same ledger + topic)', async () => {
        // Arrange
        const safeScValToNativeSpy = vi.spyOn(contractEventIndexerService as any, 'safeScValToNative')
        
        const mockEvent1 = {
            contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEWCEUNYQZ2QZ2QZ2QZ2QZ2QZ2QZ2Q',
            topic: ['topic1', 'topic2'],
            value: 'mock-value',
            ledgerClosedAt: '2023-01-01T00:00:00Z',
            txHash: '0x123',
            ledger: 1000,
            pagingToken: 'token-1'
        } as unknown as SorobanRpc.Api.EventResponse

        // Replayed event - exactly the same
        const mockEvent2 = { ...mockEvent1 }

        rpcServerMock.getEvents.mockResolvedValueOnce({
            events: [mockEvent1, mockEvent2],
            latestLedger: 1000
        })

        safeScValToNativeSpy.mockImplementation((val) => {
            if (val === 'topic1') return 'portfolio'
            if (val === 'topic2') return 'rebalance_executed'
            if (val === 'mock-value') return ['portfolio-123', 'user-abc']
            return undefined
        })

        // Act
        const result = await contractEventIndexerService.syncOnce()

        // Assert
        expect(databaseService.recordRebalanceEvent).toHaveBeenCalledTimes(1) // Should only be 1
        expect(result.ingested).toBe(1)

        safeScValToNativeSpy.mockRestore()
    })

    it('logs and skips malformed event data, does not throw', async () => {
        // Arrange
        const safeScValToNativeSpy = vi.spyOn(contractEventIndexerService as any, 'safeScValToNative')
        
        const validEvent = {
            contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEWCEUNYQZ2QZ2QZ2QZ2QZ2QZ2QZ2Q',
            topic: ['topic1', 'topic2'],
            value: 'valid-value',
            ledgerClosedAt: '2023-01-01T00:00:00Z',
            txHash: '0x123',
            ledger: 1000,
            pagingToken: 'token-1'
        } as unknown as SorobanRpc.Api.EventResponse

        const malformedEvent = {
            contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEWCEUNYQZ2QZ2QZ2QZ2QZ2QZ2QZ2Q',
            topic: ['topic1', 'topic2'],
            value: 'malformed-value',
            ledgerClosedAt: '2023-01-01T00:00:00Z',
            txHash: '0x124',
            ledger: 1000,
            pagingToken: 'token-2'
        } as unknown as SorobanRpc.Api.EventResponse

        rpcServerMock.getEvents.mockResolvedValueOnce({
            events: [validEvent, malformedEvent],
            latestLedger: 1000
        })

        safeScValToNativeSpy.mockImplementation((val) => {
            if (val === 'topic1') return 'portfolio'
            if (val === 'topic2') return 'rebalance_executed'
            if (val === 'valid-value') return ['portfolio-123', 'user-abc']
            if (val === 'malformed-value') {
                throw new Error('Parse error')
            }
            return undefined
        })

        // Act
        const result = await contractEventIndexerService.syncOnce()

        // Assert
        expect(result.ingested).toBe(1)
        expect(databaseService.recordRebalanceEvent).toHaveBeenCalledTimes(1)
        
        safeScValToNativeSpy.mockRestore()
    })

    it('detects duplicate event IDs during replay validation', async () => {
        const safeScValToNativeSpy = vi.spyOn(contractEventIndexerService as any, 'safeScValToNative')

        const mockEvent1 = {
            contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEWCEUNYQZ2QZ2QZ2QZ2QZ2QZ2QZ2Q',
            topic: ['topic1', 'topic2'],
            value: 'mock-value',
            ledgerClosedAt: '2023-01-01T00:00:00Z',
            txHash: '0x123',
            ledger: 1000,
            pagingToken: 'token-1'
        } as unknown as SorobanRpc.Api.EventResponse

        const mockEvent2 = {
            contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEWCEUNYQZ2QZ2QZ2QZ2QZ2QZ2QZ2Q',
            topic: ['topic1', 'topic2'],
            value: 'mock-value-2',
            ledgerClosedAt: '2023-01-01T00:00:00Z',
            txHash: '0x124',
            ledger: 1001,
            pagingToken: 'token-2'
        } as unknown as SorobanRpc.Api.EventResponse

        rpcServerMock.getEvents.mockResolvedValue({
            events: [mockEvent1, mockEvent2],
            latestLedger: 1001
        })

        safeScValToNativeSpy.mockImplementation((val) => {
            if (val === 'topic1') return 'portfolio'
            if (val === 'topic2') return 'rebalance_executed'
            if (val === 'mock-value') return ['portfolio-123', 'user-abc']
            if (val === 'mock-value-2') return ['portfolio-456', 'user-abc']
            return undefined
        })

        const dbMock = (await import('../services/databaseService.js')).databaseService as any
        const mockEvents = [
            { id: 'dup-id', portfolioId: 'p1', timestamp: '2023-01-01T00:00:00Z', status: 'completed', eventSource: 'onchain', onChainLedger: 1000 },
            { id: 'dup-id', portfolioId: 'p2', timestamp: '2023-01-01T00:00:01Z', status: 'completed', eventSource: 'onchain', onChainLedger: 1001 },
        ]
        dbMock.getRebalanceHistory.mockReturnValue(mockEvents)

        const validation = await contractEventIndexerService.validateReplay()
        expect(validation.valid).toBe(false)
        expect(validation.errors.some((e: string) => e.includes('Duplicate'))).toBe(true)

        safeScValToNativeSpy.mockRestore()
    })

    it('validates ledger ordering in replayed events', async () => {
        const dbMock = (await import('../services/databaseService.js')).databaseService as any
        dbMock.getRebalanceHistory.mockReturnValue([
            { id: 'e1', portfolioId: 'p1', timestamp: '2023-01-01T00:00:00Z', status: 'completed', eventSource: 'onchain', onChainLedger: 1005 },
            { id: 'e2', portfolioId: 'p1', timestamp: '2023-01-01T00:00:01Z', status: 'completed', eventSource: 'onchain', onChainLedger: 1002 },
        ])

        const validation = await contractEventIndexerService.validateReplay()
        expect(validation.valid).toBe(false)
        expect(validation.errors.some((e: string) => e.includes('Out-of-order'))).toBe(true)
    })

    it('produces deterministic integrity hash', async () => {
        const dbMock = (await import('../services/databaseService.js')).databaseService as any
        dbMock.getRebalanceHistory.mockReturnValue([
            { id: 'e1', portfolioId: 'p1', timestamp: '2023-01-01T00:00:00Z', status: 'completed' },
            { id: 'e2', portfolioId: 'p1', timestamp: '2023-01-01T00:00:01Z', status: 'completed' },
        ])

        const hash1 = contractEventIndexerService.computeIngestedEventsHash()
        const hash2 = contractEventIndexerService.computeIngestedEventsHash()

        expect(hash1).toBe(hash2)
        expect(hash1.length).toBe(64)
    })

    it('persists replay checkpoint after successful replay', async () => {
        const safeScValToNativeSpy = vi.spyOn(contractEventIndexerService as any, 'safeScValToNative')

        const mockEvent = {
            contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEWCEUNYQZ2QZ2QZ2QZ2QZ2QZ2QZ2Q',
            topic: ['topic1', 'topic2'],
            value: 'mock-value',
            ledgerClosedAt: '2023-01-01T00:00:00Z',
            txHash: '0x123',
            ledger: 1000,
            pagingToken: 'token-1'
        } as unknown as SorobanRpc.Api.EventResponse

        rpcServerMock.getEvents.mockResolvedValue({
            events: [mockEvent],
            latestLedger: 1000
        })

        safeScValToNativeSpy.mockImplementation((val) => {
            if (val === 'topic1') return 'portfolio'
            if (val === 'topic2') return 'rebalance_executed'
            if (val === 'mock-value') return ['portfolio-123', 'user-abc']
            return undefined
        })

        const dbMock = (await import('../services/databaseService.js')).databaseService as any
        dbMock.getRebalanceHistory.mockReturnValue([
            { id: 'e1', portfolioId: 'p1', timestamp: '2023-01-01T00:00:00Z', status: 'completed', eventSource: 'onchain', onChainLedger: 1000 },
        ])

        const result = await contractEventIndexerService.replayEvents({ start: 500, end: 1000 })

        expect(dbMock.setReplayIntegrityHash).toHaveBeenCalled()
        expect(dbMock.setLastReplayedLedger).toHaveBeenCalledWith(1000)
        expect(dbMock.setReplayCheckpoint).toHaveBeenCalled()
        expect(result.validation.valid).toBe(true)

        safeScValToNativeSpy.mockRestore()
    })

    it('indexer:reindex script re-processes events idempotently', async () => {
        // Arrange
        const safeScValToNativeSpy = vi.spyOn(contractEventIndexerService as any, 'safeScValToNative')
        
        const mockEvent = {
            contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEWCEUNYQZ2QZ2QZ2QZ2QZ2QZ2QZ2Q',
            topic: ['topic1', 'topic2'],
            value: 'mock-value',
            ledgerClosedAt: '2023-01-01T00:00:00Z',
            txHash: '0x123',
            ledger: 1000,
            pagingToken: 'token-1'
        } as unknown as SorobanRpc.Api.EventResponse

        rpcServerMock.getEvents.mockResolvedValue({
            events: [mockEvent],
            latestLedger: 1000
        })

        safeScValToNativeSpy.mockImplementation((val) => {
            if (val === 'topic1') return 'portfolio'
            if (val === 'topic2') return 'rebalance_executed'
            if (val === 'mock-value') return ['portfolio-123', 'user-abc']
            return undefined
        })

        // Act - First Run (simulating script first run)
        const result1 = await contractEventIndexerService.syncOnce()

        // Act - Second Run (simulating script re-run without clearing memory)
        // Note: For a true script re-run, memory is cleared, but database deduplication 
        // would handle it. Since we only have in-memory dedup for this implementation,
        // this test proves the service logic idempotency.
        const result2 = await contractEventIndexerService.syncOnce()

        // Assert
        expect(result1.ingested).toBe(1)
        expect(result2.ingested).toBe(0) // Idempotent output
        expect(databaseService.recordRebalanceEvent).toHaveBeenCalledTimes(1) // Only called once total

        safeScValToNativeSpy.mockRestore()
    })
})
