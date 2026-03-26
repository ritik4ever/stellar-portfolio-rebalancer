export interface FeatureFlags {
    demoMode: boolean
    allowFallbackPrices: boolean
    enableDebugRoutes: boolean
    allowMockPriceHistory: boolean
    allowDemoBalanceFallback: boolean
    enableDemoDbSeed: boolean
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

    return {
        demoMode,
        allowFallbackPrices,
        enableDebugRoutes,
        allowMockPriceHistory,
        allowDemoBalanceFallback,
        enableDemoDbSeed
    }
}

export const getPublicFeatureFlags = (env: NodeJS.ProcessEnv = process.env): Record<string, boolean> => {
    const flags = getFeatureFlags(env)
    return {
        DEMO_MODE: flags.demoMode,
        ALLOW_FALLBACK_PRICES: flags.allowFallbackPrices,
        ENABLE_DEBUG_ROUTES: flags.enableDebugRoutes,
        ALLOW_MOCK_PRICE_HISTORY: flags.allowMockPriceHistory,
        ALLOW_DEMO_BALANCE_FALLBACK: flags.allowDemoBalanceFallback,
        ENABLE_DEMO_DB_SEED: flags.enableDemoDbSeed
    }
}
