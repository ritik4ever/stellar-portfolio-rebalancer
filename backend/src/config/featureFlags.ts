import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../utils/logger.js'

export interface FeatureFlags {
    demoMode: boolean
    allowFallbackPrices: boolean
    enableDebugRoutes: boolean
    allowMockPriceHistory: boolean
    allowDemoBalanceFallback: boolean
    enableDemoDbSeed: boolean
    allowPublicUserPortfoliosInDemo: boolean
}

let cachedOverrides: Partial<FeatureFlags> | null = null
let cachedFilePath: string | null = null

export const clearFeatureFlagsCache = (): void => {
    cachedOverrides = null
    cachedFilePath = null
}

export const loadFeatureFlagsOverrides = (filePath: string): Partial<FeatureFlags> => {
    try {
        const absolutePath = path.resolve(process.cwd(), filePath)
        if (!fs.existsSync(absolutePath)) {
            logger.warn(`[FEATURE-FLAGS] Override file not found at: ${filePath}`)
            return {}
        }
        const content = fs.readFileSync(absolutePath, 'utf8')
        const data = JSON.parse(content)

        if (!data || typeof data !== 'object') {
            logger.warn(`[FEATURE-FLAGS] Invalid JSON content in override file: ${filePath}`)
            return {}
        }

        const overrides: Partial<FeatureFlags> = {}
        const FLAG_MAP: Record<string, keyof FeatureFlags> = {
            demoMode: 'demoMode',
            DEMO_MODE: 'demoMode',
            allowFallbackPrices: 'allowFallbackPrices',
            ALLOW_FALLBACK_PRICES: 'allowFallbackPrices',
            enableDebugRoutes: 'enableDebugRoutes',
            ENABLE_DEBUG_ROUTES: 'enableDebugRoutes',
            allowMockPriceHistory: 'allowMockPriceHistory',
            ALLOW_MOCK_PRICE_HISTORY: 'allowMockPriceHistory',
            allowDemoBalanceFallback: 'allowDemoBalanceFallback',
            ALLOW_DEMO_BALANCE_FALLBACK: 'allowDemoBalanceFallback',
            enableDemoDbSeed: 'enableDemoDbSeed',
            ENABLE_DEMO_DB_SEED: 'enableDemoDbSeed',
            allowPublicUserPortfoliosInDemo: 'allowPublicUserPortfoliosInDemo',
            ALLOW_PUBLIC_USER_PORTFOLIOS_IN_DEMO: 'allowPublicUserPortfoliosInDemo'
        }

        for (const [key, value] of Object.entries(data)) {
            const mappedKey = FLAG_MAP[key]
            if (mappedKey && typeof value === 'boolean') {
                overrides[mappedKey] = value
            } else if (mappedKey) {
                logger.warn(`[FEATURE-FLAGS] Override value for ${key} must be a boolean, got ${typeof value}`)
            } else {
                logger.warn(`[FEATURE-FLAGS] Unknown feature flag key in override file: ${key}`)
            }
        }

        return overrides
    } catch (error: any) {
        logger.error(`[FEATURE-FLAGS] Failed to read or parse override file at ${filePath}: ${error.message}`)
        throw new Error(`Failed to load feature flag overrides from ${filePath}: ${error.message}`)
    }
}

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
    if (value === undefined || value === null || value.trim() === '') return fallback
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
    return fallback
}

export const getFeatureFlags = (env: NodeJS.ProcessEnv = process.env): FeatureFlags => {
    const isProduction = (env.NODE_ENV || 'development').trim().toLowerCase() === 'production'

    const demoMode = parseBoolean(env.DEMO_MODE, !isProduction)
    const allowFallbackPrices = parseBoolean(env.ALLOW_FALLBACK_PRICES, !isProduction)
    const enableDebugRoutes = parseBoolean(env.ENABLE_DEBUG_ROUTES, false) // Default to false even in dev
    const allowMockPriceHistory = parseBoolean(env.ALLOW_MOCK_PRICE_HISTORY, demoMode)
    const allowDemoBalanceFallback = parseBoolean(env.ALLOW_DEMO_BALANCE_FALLBACK, demoMode)
    const enableDemoDbSeed = parseBoolean(env.ENABLE_DEMO_DB_SEED, demoMode)
    const allowPublicUserPortfoliosInDemo = parseBoolean(env.ALLOW_PUBLIC_USER_PORTFOLIOS_IN_DEMO, false)

    const flags: FeatureFlags = {
        demoMode,
        allowFallbackPrices,
        enableDebugRoutes,
        allowMockPriceHistory,
        allowDemoBalanceFallback,
        enableDemoDbSeed,
        allowPublicUserPortfoliosInDemo
    }

    const overrideFile = env.FEATURE_FLAGS_FILE ? env.FEATURE_FLAGS_FILE.trim() : ''
    if (overrideFile) {
        if (cachedFilePath !== overrideFile || cachedOverrides === null) {
            cachedOverrides = loadFeatureFlagsOverrides(overrideFile)
            cachedFilePath = overrideFile
            logger.info(`[FEATURE-FLAGS] Loaded overrides from ${overrideFile}`, { overrides: cachedOverrides })
        }

        for (const [key, value] of Object.entries(cachedOverrides)) {
            if (value !== undefined) {
                (flags as any)[key] = value
            }
        }
    } else {
        if (cachedFilePath !== null) {
            clearFeatureFlagsCache()
        }
    }

    return flags
}

export const getPublicFeatureFlags = (env: NodeJS.ProcessEnv = process.env): Record<string, boolean> => {
    const flags = getFeatureFlags(env)
    return {
        DEMO_MODE: flags.demoMode,
        ALLOW_FALLBACK_PRICES: flags.allowFallbackPrices,
        ENABLE_DEBUG_ROUTES: flags.enableDebugRoutes,
        ALLOW_MOCK_PRICE_HISTORY: flags.allowMockPriceHistory,
        ALLOW_DEMO_BALANCE_FALLBACK: flags.allowDemoBalanceFallback,
        ENABLE_DEMO_DB_SEED: flags.enableDemoDbSeed,
        ALLOW_PUBLIC_USER_PORTFOLIOS_IN_DEMO: flags.allowPublicUserPortfoliosInDemo
    }
}

export const isFeatureFlagEnabled = (
    flagName: string,
    env: NodeJS.ProcessEnv = process.env
): boolean => {
    const flags = getFeatureFlags(env) as unknown as Record<string, boolean>
    return flags[flagName] ?? false
}

