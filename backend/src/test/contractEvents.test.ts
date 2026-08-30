import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'
import { Keypair } from '@stellar/stellar-sdk'
import { contractEventsService } from '../services/contractEvents.js'
import { contractEventIndexerService } from '../services/contractEventIndexer.js'

// Mock ReflectorService and StellarService to prevent circular dependency instantiation issues
vi.mock('../services/reflector.js', () => {
    return {
        ReflectorService: class {
            getCurrentPrices = vi.fn().mockResolvedValue({})
            getCurrentPricesWithMeta = vi.fn().mockResolvedValue({ prices: {}, feedMeta: {} })
        }
    }
})

vi.mock('../services/stellar.js', () => {
    return {
        StellarService: class {
            getPortfolio = vi.fn()
        }
    }
})


// Mock the indexer service
vi.mock('../services/contractEventIndexer.js', () => {
    let mockCursor: string | undefined = undefined
    let mockLatestLedger: number | undefined = undefined
    let mockEnabled = true

    return {
        contractEventIndexerService: {
            isEnabled: vi.fn(() => mockEnabled),
            resetCursor: vi.fn((fromLedger?: number) => {
                mockCursor = undefined
                mockLatestLedger = fromLedger
            }),
            syncOnce: vi.fn(async () => {
                mockCursor = 'next-token-123'
                return { ingested: 5, latestLedger: 1005 }
            }),
            getCursorInfo: vi.fn(() => ({
                cursor: mockCursor,
                latestLedger: mockLatestLedger,
                lastSuccessfulSyncAt: '2023-01-01T00:00:00Z',
                lastFailedSyncAt: undefined,
                lastError: undefined,
                pollIntervalMs: 15000,
                bootstrapWindowLedgers: 500,
                consecutiveFailures: 0,
                recentErrors: []
            })),
            getStatus: vi.fn(() => ({
                enabled: mockEnabled,
                running: false,
                pollIntervalMs: 15000,
                lastIngestedCount: 5,
                consecutiveFailures: 0,
                recentErrors: [],
                expectedEventSchemaVersion: 1,
                contractEventSchemaOk: true
            })),
            // helper to mutate mock state in tests
            __setMockEnabled: (val: boolean) => {
                mockEnabled = val
            }
        }
    }
})

describe('ContractEventsService Unit Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // Reset the mock enabled flag
        const indexerMock = contractEventIndexerService as any
        if (indexerMock.__setMockEnabled) {
            indexerMock.__setMockEnabled(true)
        }
    })

    it('successfully replays events from a valid ledger', async () => {
        const result = await contractEventsService.replayFromLedger(5000)

        expect(result.success).toBe(true)
        expect(result.fromLedger).toBe(5000)
        expect(result.ingested).toBe(5)
        expect(result.latestLedger).toBe(1005)
        expect(result.cursorAfter).toBe('next-token-123')
        expect(contractEventIndexerService.resetCursor).toHaveBeenCalledWith(5000)
        expect(contractEventIndexerService.syncOnce).toHaveBeenCalled()
    })

    it('rejects invalid or non-integer ledgers', async () => {
        const result1 = await contractEventsService.replayFromLedger(-10)
        expect(result1.success).toBe(false)
        expect(result1.message).toContain('positive integer')

        const result2 = await contractEventsService.replayFromLedger(5.5)
        expect(result2.success).toBe(false)
        expect(result2.message).toContain('positive integer')
    })

    it('returns failure when contract event indexer is disabled', async () => {
        const indexerMock = contractEventIndexerService as any
        if (indexerMock.__setMockEnabled) {
            indexerMock.__setMockEnabled(false)
        }

        const result = await contractEventsService.replayFromLedger(5000)
        expect(result.success).toBe(false)
        expect(result.message).toContain('disabled')
        expect(contractEventIndexerService.resetCursor).not.toHaveBeenCalled()
    })
})

describe('Admin Event Replay HTTP Endpoint', () => {
    let app: Express
    let adminKp: Keypair
    let nonAdminKp: Keypair

    function makeAdminHeaders(kp: Keypair) {
        const msg = Date.now().toString()
        const sig = kp.sign(Buffer.from(msg, 'utf8')).toString('base64')
        return {
            'x-public-key': kp.publicKey(),
            'x-message': msg,
            'x-signature': sig,
        }
    }

    beforeEach(async () => {
        adminKp = Keypair.random()
        nonAdminKp = Keypair.random()
        vi.stubEnv('ADMIN_PUBLIC_KEYS', adminKp.publicKey())

        // Re-import modules to ensure stubEnv takes effect
        vi.resetModules()

        const { portfolioRouter } = await import('../api/routes.js')
        app = express()
        app.use(express.json())
        app.use('/api', portfolioRouter)

        // Reset the mock enabled flag
        const indexerMock = contractEventIndexerService as any
        if (indexerMock.__setMockEnabled) {
            indexerMock.__setMockEnabled(true)
        }
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('returns 401 unauthorized without admin headers', async () => {
        const res = await request(app)
            .post('/api/admin/events/replay')
            .query({ from_ledger: '1000' })

        expect(res.status).toBe(401)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('UNAUTHORIZED')
    })

    it('returns 403 forbidden for non-admin credentials', async () => {
        const res = await request(app)
            .post('/api/admin/events/replay')
            .query({ from_ledger: '1000' })
            .set(makeAdminHeaders(nonAdminKp))

        expect(res.status).toBe(403)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('FORBIDDEN')
    })

    it('returns 400 validation error for missing from_ledger query parameter', async () => {
        const res = await request(app)
            .post('/api/admin/events/replay')
            .set(makeAdminHeaders(adminKp))

        expect(res.status).toBe(400)
        expect(res.body.success).toBe(false)
        expect(res.body.error.message).toContain('from_ledger')
    })

    it('returns 400 validation error for invalid from_ledger values', async () => {
        const res1 = await request(app)
            .post('/api/admin/events/replay')
            .query({ from_ledger: '-5' })
            .set(makeAdminHeaders(adminKp))

        expect(res1.status).toBe(400)

        const res2 = await request(app)
            .post('/api/admin/events/replay')
            .query({ from_ledger: 'abc' })
            .set(makeAdminHeaders(adminKp))

        expect(res2.status).toBe(400)
    })

    it('successfully performs replay with valid admin headers and valid from_ledger', async () => {
        const res = await request(app)
            .post('/api/admin/events/replay')
            .query({ from_ledger: '5000' })
            .set(makeAdminHeaders(adminKp))

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.fromLedger).toBe(5000)
        expect(res.body.data.ingested).toBe(5)
        expect(res.body.data.latestLedger).toBe(1005)
        expect(res.body.data.cursorAfter).toBe('next-token-123')
    })

    it('returns 422 if the replay service returns failure', async () => {
        const indexerMock = contractEventIndexerService as any
        if (indexerMock.__setMockEnabled) {
            indexerMock.__setMockEnabled(false)
        }

        const res = await request(app)
            .post('/api/admin/events/replay')
            .query({ from_ledger: '5000' })
            .set(makeAdminHeaders(adminKp))

        expect(res.status).toBe(422)
        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('REPLAY_FAILED')
    })
})
