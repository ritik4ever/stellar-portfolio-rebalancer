import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getFeatureFlags, isFeatureFlagEnabled } from '../config/featureFlags.js'
import { validateStartupConfigOrThrow, logStartupSubsystems, buildStartupSummary } from '../config/startupConfig.js'
import { logger } from '../utils/logger.js'

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

    it('parses notification delivery backoff from environment', () => {
        process.env = {
            ...process.env,
            ...REQUIRED_STARTUP_ENV,
            WEBHOOK_RETRY_COUNT: '2',
            EMAIL_MAX_ATTEMPTS: '4',
        }
        const config = validateStartupConfigOrThrow(process.env)
        expect(config.notificationDelivery.webhook.maxAttempts).toBe(3)
        expect(config.notificationDelivery.email.maxAttempts).toBe(4)

        const summary = buildStartupSummary(config)
        expect(summary.notificationDelivery).toMatchObject({
            email: { maxAttempts: 4 },
            webhook: { maxAttempts: 3 },
        })
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
})
