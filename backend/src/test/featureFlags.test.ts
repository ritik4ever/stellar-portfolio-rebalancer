import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getFeatureFlags, isFeatureFlagEnabled, clearFeatureFlagsCache } from '../config/featureFlags.js'
import { validateStartupConfigOrThrow, logStartupSubsystems } from '../config/startupConfig.js'
import { logger } from '../utils/logger.js'
import fs from 'node:fs'
import path from 'node:path'

const ORIGINAL_ENV = { ...process.env }

const REQUIRED_STARTUP_ENV = {
    NODE_ENV: 'development',
    PORT: '3001',
    STELLAR_NETWORK: 'testnet',
    STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    CONTRACT_ADDRESS: `C${'A'.repeat(55)}`,
    STELLAR_REBALANCE_SECRET: `S${'A'.repeat(55)}`
}

describe('featureFlags', () => {
    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV }
        delete process.env.ENABLE_DEBUG_ROUTES
        delete process.env.DEMO_MODE
        delete process.env.ALLOW_FALLBACK_PRICES
        delete process.env.ALLOW_MOCK_PRICE_HISTORY
        delete process.env.ALLOW_DEMO_BALANCE_FALLBACK
        delete process.env.ENABLE_DEMO_DB_SEED
        delete process.env.ALLOW_PUBLIC_USER_PORTFOLIOS_IN_DEMO
        delete process.env.FEATURE_FLAGS_FILE
        clearFeatureFlagsCache()
    })

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV }
        vi.restoreAllMocks()
    })

    it('enables a flag via environment variable', () => {
        process.env.ENABLE_DEBUG_ROUTES = 'true'
        expect(getFeatureFlags().enableDebugRoutes).toBe(true)
        expect(isFeatureFlagEnabled('enableDebugRoutes')).toBe(true)
    })

    it('returns false for unknown flag names by default', () => {
        expect(isFeatureFlagEnabled('thisFlagDoesNotExist')).toBe(false)
    })

    it('applies runtime flag toggles on the next request evaluation', () => {
        const evaluateRequestFlag = () => getFeatureFlags().enableDebugRoutes

        process.env.ENABLE_DEBUG_ROUTES = 'false'
        expect(evaluateRequestFlag()).toBe(false)

        process.env.ENABLE_DEBUG_ROUTES = 'true'
        expect(evaluateRequestFlag()).toBe(true)
    })

    it('logs feature flag state during startup', () => {
        process.env = { ...process.env, ...REQUIRED_STARTUP_ENV, ENABLE_DEBUG_ROUTES: 'true' }
        const config = validateStartupConfigOrThrow(process.env)
        const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined)

        logStartupSubsystems(config, true, 'redis')

        expect(infoSpy).toHaveBeenCalledWith(
            '[STARTUP] Subsystem status',
            expect.objectContaining({
                featureFlags: expect.objectContaining({
                    demoMode: expect.any(Boolean),
                    debugRoutes: true
                })
            })
        )
    })

    it('defines expected coverage for all current feature flags', () => {
        const keys = Object.keys(getFeatureFlags()).sort()
        expect(keys).toEqual([
            'allowDemoBalanceFallback',
            'allowFallbackPrices',
            'allowMockPriceHistory',
            'allowPublicUserPortfoliosInDemo',
            'demoMode',
            'enableDebugRoutes',
            'enableDemoDbSeed'
        ])
    })

    it('parses READINESS_CACHE_TTL_MS from environment', () => {
        process.env = { ...process.env, ...REQUIRED_STARTUP_ENV, READINESS_CACHE_TTL_MS: '5000' }
        const config = validateStartupConfigOrThrow(process.env)
        expect(config.readinessCacheTtlMs).toBe(5000)
    })

    it('defaults READINESS_CACHE_TTL_MS to 2000', () => {
        delete process.env.READINESS_CACHE_TTL_MS
        process.env = { ...process.env, ...REQUIRED_STARTUP_ENV }
        const config = validateStartupConfigOrThrow(process.env)
        expect(config.readinessCacheTtlMs).toBe(2000)
    })

    it('parses CONSENT_AUDIT_RETENTION_DAYS from environment', () => {
        process.env = { ...process.env, ...REQUIRED_STARTUP_ENV, CONSENT_AUDIT_RETENTION_DAYS: '90' }
        const config = validateStartupConfigOrThrow(process.env)
        expect(config.consentAuditRetentionDays).toBe(90)
    })

    it('defaults CONSENT_AUDIT_RETENTION_DAYS to 365', () => {
        delete process.env.CONSENT_AUDIT_RETENTION_DAYS
        process.env = { ...process.env, ...REQUIRED_STARTUP_ENV }
        const config = validateStartupConfigOrThrow(process.env)
        expect(config.consentAuditRetentionDays).toBe(365)
    })

    it('parses METRICS_ALLOWLIST from environment', () => {
        process.env = { ...process.env, ...REQUIRED_STARTUP_ENV, METRICS_ALLOWLIST: '10.0.0.1,192.168.0.0/16' }
        const config = validateStartupConfigOrThrow(process.env)
        expect(config.metricsAllowlist).toContain('10.0.0.1')
        expect(config.metricsAllowlist).toContain('192.168.0.0/16')
        expect(config.metricsAllowlist).toHaveLength(2)
    })

    it('defaults metricsAllowlist to empty array', () => {
        delete process.env.METRICS_ALLOWLIST
        process.env = { ...process.env, ...REQUIRED_STARTUP_ENV }
        const config = validateStartupConfigOrThrow(process.env)
        expect(config.metricsAllowlist).toEqual([])
    })

    it('validates CONSENT_AUDIT_RETENTION_DAYS must be a positive integer', () => {
        process.env = { ...process.env, ...REQUIRED_STARTUP_ENV, CONSENT_AUDIT_RETENTION_DAYS: '0' }
        expect(() => validateStartupConfigOrThrow(process.env)).toThrow()
    })

    it('validates READINESS_CACHE_TTL_MS must be a non-negative integer', () => {
        process.env = { ...process.env, ...REQUIRED_STARTUP_ENV, READINESS_CACHE_TTL_MS: '-1' }
        expect(() => validateStartupConfigOrThrow(process.env)).toThrow()
    })

    describe('file-based overrides', () => {
        const tempFilePath = path.join(process.cwd(), 'temp-feature-flags-override-test.json')

        afterEach(() => {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath)
            }
            clearFeatureFlagsCache()
        })

        it('overrides feature flags from a JSON file with camelCase keys', () => {
            fs.writeFileSync(tempFilePath, JSON.stringify({
                demoMode: false,
                enableDebugRoutes: true
            }))

            process.env.FEATURE_FLAGS_FILE = tempFilePath
            const flags = getFeatureFlags()

            expect(flags.demoMode).toBe(false)
            expect(flags.enableDebugRoutes).toBe(true)
        })

        it('overrides feature flags from a JSON file with UPPER_SNAKE_CASE keys', () => {
            fs.writeFileSync(tempFilePath, JSON.stringify({
                DEMO_MODE: false,
                ENABLE_DEBUG_ROUTES: true
            }))

            process.env.FEATURE_FLAGS_FILE = tempFilePath
            const flags = getFeatureFlags()

            expect(flags.demoMode).toBe(false)
            expect(flags.enableDebugRoutes).toBe(true)
        })

        it('ignores unknown keys and non-boolean values gracefully, logging warnings', () => {
            const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
            fs.writeFileSync(tempFilePath, JSON.stringify({
                demoMode: 'not-a-boolean',
                someUnknownKey: true,
                enableDebugRoutes: true
            }))

            process.env.FEATURE_FLAGS_FILE = tempFilePath
            const flags = getFeatureFlags()

            // Invalid value should fallback to original environment value or default (true in development)
            expect(flags.demoMode).toBe(true) 
            expect(flags.enableDebugRoutes).toBe(true)
            expect(warnSpy).toHaveBeenCalled()
        })

        it('caches overrides and does not read from file on subsequent calls unless cleared', () => {
            fs.writeFileSync(tempFilePath, JSON.stringify({
                demoMode: false
            }))

            process.env.FEATURE_FLAGS_FILE = tempFilePath
            expect(getFeatureFlags().demoMode).toBe(false)

            // Modify file content directly
            fs.writeFileSync(tempFilePath, JSON.stringify({
                demoMode: true
            }))

            // Should still return false because it is cached
            expect(getFeatureFlags().demoMode).toBe(false)

            // Clear cache
            clearFeatureFlagsCache()

            // Should now pick up the new value (true)
            expect(getFeatureFlags().demoMode).toBe(true)
        })

        it('throws an error during startup configuration validation if override file is invalid JSON', () => {
            fs.writeFileSync(tempFilePath, 'this is not JSON')

            process.env = {
                ...process.env,
                ...REQUIRED_STARTUP_ENV,
                FEATURE_FLAGS_FILE: tempFilePath
            }

            expect(() => validateStartupConfigOrThrow(process.env)).toThrow(/Failed to load feature flag overrides/)
        })

        it('handles non-existent override file by logging a warning and proceeding with environment defaults', () => {
            const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
            process.env.FEATURE_FLAGS_FILE = 'does-not-exist.json'

            const flags = getFeatureFlags()
            expect(flags.demoMode).toBe(true) // Development default
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Override file not found at'))
        })
    })
})
