import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getFeatureFlags, isFeatureFlagEnabled } from '../config/featureFlags.js'
import { validateStartupConfigOrThrow, logStartupSubsystems } from '../config/startupConfig.js'
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
})
