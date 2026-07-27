import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('assetRegistryService Unit Tests', () => {
    let testDbPath: string
    let databaseService: any
    let assetRegistryService: any
    const envBackup = { ...process.env }

    beforeEach(async () => {
        const testDir = join(tmpdir(), `stellar-service-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        mkdirSync(testDir, { recursive: true })
        testDbPath = join(testDir, 'assets-test.db')

        vi.resetModules()
        process.env = { ...envBackup }
        delete process.env.DATABASE_URL
        process.env.DB_PATH = testDbPath
        process.env.ENABLE_DEMO_DB_SEED = 'false'

        const dbModule = await import('../services/databaseService.js')
        databaseService = dbModule.databaseService
        const registryModule = await import('../services/assetRegistryService.js')
        assetRegistryService = registryModule.assetRegistryService
    })

    afterEach(() => {
        if (databaseService) {
            databaseService.close()
        }
        process.env = envBackup
        if (testDbPath) {
            const dir = join(testDbPath, '..')
            if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
        }
    })

    describe('isAssetStale & isAssetQuarantineExpired', () => {
        it('identifies undefined/never refreshed as stale and quarantine expired', () => {
            expect(assetRegistryService.isAssetStale(undefined)).toBe(true)
            expect(assetRegistryService.isAssetQuarantineExpired(undefined)).toBe(true)
        })

        it('identifies fresh timestamps correctly', () => {
            const nowIso = new Date().toISOString()
            expect(assetRegistryService.isAssetStale(nowIso)).toBe(false)
            expect(assetRegistryService.isAssetQuarantineExpired(nowIso)).toBe(false)
        })

        it('identifies stale and quarantine-expired timestamps correctly based on elapsed time', () => {
            // 25 hours ago is stale (policy 24h)
            const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
            expect(assetRegistryService.isAssetStale(staleTime)).toBe(true)
            expect(assetRegistryService.isAssetQuarantineExpired(staleTime)).toBe(false)

            // 8 days ago is quarantined (policy 7d)
            const quarantineTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
            expect(assetRegistryService.isAssetStale(quarantineTime)).toBe(true)
            expect(assetRegistryService.isAssetQuarantineExpired(quarantineTime)).toBe(true)
        })
    })

    describe('checkAndApplyAutoQuarantine', () => {
        it('automatically quarantines asset when quarantine threshold is reached', () => {
            // Add a test asset
            databaseService.addAsset('TST', 'Test Asset', { coingeckoId: 'test-asset' })
            
            // Set its freshness to 8 days ago
            const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
            databaseService.setAssetFreshness('TST', oldTime, false)

            const rawAsset = databaseService.getAssetBySymbol('TST')!
            expect(rawAsset.isQuarantined).toBe(false)

            // Applying auto quarantine check
            const processed = assetRegistryService.checkAndApplyAutoQuarantine(rawAsset)
            expect(processed.isQuarantined).toBe(true)
            expect(processed.stale).toBe(true)

            // Verify it was updated in the DB
            const dbAsset = databaseService.getAssetBySymbol('TST')!
            expect(dbAsset.isQuarantined).toBe(true)
        })
    })

    describe('refreshAssetSource', () => {
        it('refreshes successfully and resets quarantine flag', async () => {
            // XLM is already seeded by default!
            
            // Set as quarantined initially
            databaseService.setAssetFreshness('XLM', new Date(0).toISOString(), true)

            // Mock fetch to succeed
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ stellar: { usd: 0.12 } })
            })
            global.fetch = mockFetch

            const success = await assetRegistryService.refreshAssetSource('XLM')
            expect(success).toBe(true)

            const asset = assetRegistryService.getBySymbol('XLM')!
            expect(asset.isQuarantined).toBe(false)
            expect(asset.stale).toBe(false)
            expect(asset.lastRefreshedAt).toBeDefined()
        })

        it('quarantines asset if fetch fails and last refreshed is too old', async () => {
            databaseService.addAsset('BAD', 'Bad Coin', { coingeckoId: 'bad-coin' })
            
            // Set last refreshed to 8 days ago
            const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
            databaseService.setAssetFreshness('BAD', oldTime, false)

            // Mock fetch to fail
            const mockFetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Error'
            })
            global.fetch = mockFetch

            const success = await assetRegistryService.refreshAssetSource('BAD')
            expect(success).toBe(false)

            const asset = assetRegistryService.getBySymbol('BAD')
            // Since it is quarantined and enabledOnly is true, it shouldn't show up in default getBySymbol list/filter
            // Let's verify it directly in the DB
            const dbAsset = databaseService.getAssetBySymbol('BAD')!
            expect(dbAsset.isQuarantined).toBe(true)
        })
    })
})
