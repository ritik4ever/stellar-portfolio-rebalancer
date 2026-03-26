import { getFeatureFlags, type FeatureFlags } from './featureFlags.js'
import { logger } from '../utils/logger.js'

export interface StartupConfig {
    nodeEnv: 'development' | 'test' | 'production'
    port: number
    stellarNetwork: 'testnet' | 'mainnet'
    stellarHorizonUrl: string
    stellarContractAddress: string
    autoRebalancerEnabled: boolean
    corsOrigins: string[]
    hasRebalanceSigner: boolean
    featureFlags: FeatureFlags
}

const NODE_ENVS = new Set(['development', 'test', 'production'])
const STELLAR_NETWORKS = new Set(['testnet', 'mainnet'])
const STELLAR_CONTRACT_REGEX = /^C[A-Z2-7]{55}$/
const STELLAR_SECRET_REGEX = /^S[A-Z2-7]{55}$/

export function validateStartupConfigOrThrow(env: NodeJS.ProcessEnv = process.env): StartupConfig {
    const errors: string[] = []
    const warnings: string[] = []

    const nodeEnvRaw = (env.NODE_ENV || 'development').trim().toLowerCase()
    const nodeEnv = NODE_ENVS.has(nodeEnvRaw) ? (nodeEnvRaw as StartupConfig['nodeEnv']) : undefined
    if (!nodeEnv) {
        errors.push(`NODE_ENV '${env.NODE_ENV}' is invalid. Allowed values: development, test, production.`)
    }

    const portRaw = (env.PORT || '3001').trim()
    const port = Number.parseInt(portRaw, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push(`PORT '${env.PORT}' is invalid. Provide an integer between 1 and 65535.`)
    }

    const featureFlags = getFeatureFlags(env)
    if (nodeEnv === 'production' && featureFlags.demoMode) {
        errors.push('DEMO_MODE cannot be true in production.')
    }
    if (nodeEnv === 'production' && featureFlags.allowDemoBalanceFallback) {
        warnings.push('ALLOW_DEMO_BALANCE_FALLBACK is enabled in production.')
    }
    if (nodeEnv === 'production' && featureFlags.enableDemoDbSeed) {
        warnings.push('ENABLE_DEMO_DB_SEED is enabled in production.')
    }
    if (nodeEnv === 'production' && featureFlags.allowMockPriceHistory) {
        warnings.push('ALLOW_MOCK_PRICE_HISTORY is enabled in production.')
    }
    if (nodeEnv === 'production' && featureFlags.allowFallbackPrices) {
        warnings.push('ALLOW_FALLBACK_PRICES is enabled in production.')
    }

    const stellarNetworkRaw = (env.STELLAR_NETWORK || 'testnet').trim().toLowerCase()
    const stellarNetwork = STELLAR_NETWORKS.has(stellarNetworkRaw)
        ? (stellarNetworkRaw as StartupConfig['stellarNetwork'])
        : undefined
    if (!stellarNetwork) {
        errors.push(`STELLAR_NETWORK '${env.STELLAR_NETWORK}' is invalid. Allowed values: testnet, mainnet.`)
    }

    const horizonUrlRaw = (env.STELLAR_HORIZON_URL || '').trim()
    if (!horizonUrlRaw) {
        errors.push('STELLAR_HORIZON_URL is required and must be a valid http(s) URL.')
    }

    let horizonUrl: URL | undefined
    if (horizonUrlRaw) {
        try {
            horizonUrl = new URL(horizonUrlRaw)
            if (horizonUrl.protocol !== 'http:' && horizonUrl.protocol !== 'https:') {
                errors.push(`STELLAR_HORIZON_URL '${horizonUrlRaw}' must use http or https.`)
            }
        } catch {
            errors.push(`STELLAR_HORIZON_URL '${horizonUrlRaw}' is not a valid URL.`)
        }
    }

    const contractAddress = (env.CONTRACT_ADDRESS || env.STELLAR_CONTRACT_ADDRESS || '').trim()
    if (!contractAddress) {
        errors.push('Set CONTRACT_ADDRESS or STELLAR_CONTRACT_ADDRESS to a deployed contract address.')
    } else if (!STELLAR_CONTRACT_REGEX.test(contractAddress)) {
        errors.push('Contract address format is invalid. Expected a Soroban contract strkey starting with C.')
    }

    if (
        env.CONTRACT_ADDRESS &&
        env.STELLAR_CONTRACT_ADDRESS &&
        env.CONTRACT_ADDRESS.trim() !== env.STELLAR_CONTRACT_ADDRESS.trim()
    ) {
        errors.push('CONTRACT_ADDRESS and STELLAR_CONTRACT_ADDRESS are both set but do not match.')
    }

    const signerSecret = (env.STELLAR_REBALANCE_SECRET || env.STELLAR_SECRET_KEY || '').trim()
    if (!featureFlags.demoMode || !featureFlags.allowDemoBalanceFallback) {
        if (!signerSecret) {
            errors.push('Set STELLAR_REBALANCE_SECRET (or STELLAR_SECRET_KEY) for signed DEX rebalance execution.')
        } else if (!STELLAR_SECRET_REGEX.test(signerSecret)) {
            errors.push('STELLAR_REBALANCE_SECRET format is invalid. Expected a Stellar secret starting with S.')
        }
    } else if (signerSecret && !STELLAR_SECRET_REGEX.test(signerSecret)) {
        errors.push('STELLAR_REBALANCE_SECRET format is invalid. Expected a Stellar secret starting with S.')
    }

    if (stellarNetwork && horizonUrl) {
        const host = horizonUrl.hostname.toLowerCase()
        const isTestnetHost = host.includes('testnet')
        if (stellarNetwork === 'testnet' && !isTestnetHost) {
            warnings.push('STELLAR_NETWORK is testnet but STELLAR_HORIZON_URL does not look like a testnet endpoint.')
        }
        if (stellarNetwork === 'mainnet' && isTestnetHost) {
            errors.push('STELLAR_NETWORK is mainnet but STELLAR_HORIZON_URL points to a testnet host.')
        }
    }

    const corsOrigins = (env.CORS_ORIGINS || '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)

    const autoRebalancerEnabled = env.NODE_ENV === 'production' || env.ENABLE_AUTO_REBALANCER === 'true'

    if (errors.length > 0) {
        const numberedErrors = errors.map((msg, idx) => `${idx + 1}. ${msg}`).join('\n')
        throw new Error(
            [
                '[STARTUP-CONFIG] Validation failed. Server will not start.',
                numberedErrors,
                'Fix the values in backend/.env and restart the server.'
            ].join('\n')
        )
    }

    if (warnings.length > 0) {
        const numberedWarnings = warnings.map((msg, idx) => `${idx + 1}. ${msg}`).join('\n')
        logger.warn('[STARTUP-CONFIG] Warnings', { warnings })
    }

    return {
        nodeEnv: (nodeEnv || 'development'),
        port: Number.isInteger(port) ? port : 3001,
        stellarNetwork: (stellarNetwork || 'testnet'),
        stellarHorizonUrl: horizonUrlRaw,
        stellarContractAddress: contractAddress,
        autoRebalancerEnabled,
        corsOrigins,
        hasRebalanceSigner: !!signerSecret,
        featureFlags
    }
}

export function buildStartupSummary(config: StartupConfig): Record<string, unknown> {
    return {
        nodeEnv: config.nodeEnv,
        port: config.port,
        stellarNetwork: config.stellarNetwork,
        horizonHost: safeUrlHost(config.stellarHorizonUrl),
        contractAddress: maskValue(config.stellarContractAddress, 6, 4),
        autoRebalancerEnabled: config.autoRebalancerEnabled,
        rebalanceSignerConfigured: config.hasRebalanceSigner,
        corsOriginsConfigured: config.corsOrigins.length,
        featureFlags: {
            demoMode: config.featureFlags.demoMode,
            allowFallbackPrices: config.featureFlags.allowFallbackPrices,
            enableDebugRoutes: config.featureFlags.enableDebugRoutes,
            allowMockPriceHistory: config.featureFlags.allowMockPriceHistory,
            allowDemoBalanceFallback: config.featureFlags.allowDemoBalanceFallback,
            enableDemoDbSeed: config.featureFlags.enableDemoDbSeed
        }
    }
}

function safeUrlHost(url: string): string {
    try {
        return new URL(url).host
    } catch {
        return '<invalid-url>'
    }
}

function maskValue(value: string, head: number, tail: number): string {
    if (!value || value.length <= head + tail) return '<hidden>'
    return `${value.slice(0, head)}...${value.slice(-tail)}`
}
