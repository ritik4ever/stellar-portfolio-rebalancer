import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'
import type { PriceFeedClientMeta } from './usePricesQuery'

export const portfolioKeys = {
    all: ['portfolios'] as const,
    lists: () => [...portfolioKeys.all, 'list'] as const,
    list: (address: string) => [...portfolioKeys.lists(), address] as const,
    details: () => [...portfolioKeys.all, 'detail'] as const,
    detail: (id: string) => [...portfolioKeys.details(), id] as const,
}

export type RebalanceConfirmationSummary = {
    slippage: string[]
    prices: string[]
    risks: string[]
}

export type RebalancePrecondition = {
    id: string
    label: string
    ok: boolean
    detail?: string
}

export type RebalancePlanSnapshot = {
    portfolioId: string
    totalValue: number
    maxSlippagePercent: number
    estimatedSlippageBps: number
    priceFeedMeta?: PriceFeedClientMeta
}

export function buildRebalanceConfirmationSummary(input: {
    slippageTolerancePercent?: number | null
    slippageTolerance?: number | null
    feedMeta?: PriceFeedClientMeta
    hasPartialPriceData: boolean
    partialPriceMessage: string | null
    estimate?: {
        gasEstimateXlm?: number
        gasEstimateUsd?: number
        gasWarning?: boolean
        tradeCount?: number
    } | null
    hasHighGasWarning: boolean
}): RebalanceConfirmationSummary {
    const slippage: string[] = []
    const tolerance = input.slippageTolerancePercent ?? input.slippageTolerance
    if (tolerance != null) {
        slippage.push(
            `Trades that move more than ${tolerance}% away from the quoted price will be rejected.`,
        )
    } else {
        slippage.push('No slippage limit is set on this portfolio; large price moves during execution may cost more than expected.')
    }
    slippage.push('On-chain swaps can fill at worse prices than the dashboard quote when markets move quickly.')

    const prices: string[] = []
    if (input.feedMeta?.degraded) {
        prices.push('Quotes are using synthetic or fallback data, not primary exchange prices.')
    } else if (input.feedMeta?.staleOrLimited) {
        prices.push('Quotes may be stale or served from cache after an upstream error or rate limit.')
    }
    if (input.hasPartialPriceData && input.partialPriceMessage) {
        prices.push(input.partialPriceMessage)
    }
    if (prices.length === 0) {
        prices.push('Rebalance sizing uses the latest price feed shown on this dashboard.')
    }

    const risks: string[] = []
    const tradeCount = input.estimate?.tradeCount ?? 0
    if (tradeCount > 0) {
        risks.push(`About ${tradeCount} on-chain trade${tradeCount === 1 ? '' : 's'} may run in sequence; each needs network fees.`)
    }
    const xlm = input.estimate?.gasEstimateXlm ?? 0
    const usd = input.estimate?.gasEstimateUsd ?? 0
    if (xlm > 0) {
        risks.push(`Estimated network cost: ${xlm.toFixed(4)} XLM (~$${usd.toFixed(3)}).`)
    }
    if (input.hasHighGasWarning) {
        risks.push('Estimated gas is higher than usual; consider fewer trades or waiting for calmer network conditions.')
    }
    risks.push('Executed trades cannot be reversed from this app; review allocations before confirming.')

    return { slippage, prices, risks }
}

export function buildRebalancePreconditions(input: {
    publicKey: string | null
    portfolioId?: string | null
    needsRebalance?: boolean
    hasPartialPriceData: boolean
    feedDegraded?: boolean
    tradeCount: number
    hasHighGasWarning: boolean
}): RebalancePrecondition[] {
    const walletOk = Boolean(input.publicKey)
    const portfolioOk = Boolean(input.portfolioId && input.portfolioId !== 'demo')
    const driftOk = input.needsRebalance !== false
    const pricesOk = !input.hasPartialPriceData && !input.feedDegraded
    const tradesOk = input.tradeCount > 0
    const gasOk = !input.hasHighGasWarning

    return [
        {
            id: 'wallet',
            label: 'Wallet connected',
            ok: walletOk,
            detail: walletOk ? undefined : 'Connect your Stellar wallet before rebalancing.',
        },
        {
            id: 'portfolio',
            label: 'Live portfolio selected',
            ok: portfolioOk,
            detail: portfolioOk ? undefined : 'Create a saved portfolio (demo mode cannot rebalance).',
        },
        {
            id: 'drift',
            label: 'Rebalance threshold met',
            ok: driftOk,
            detail: driftOk ? undefined : 'Allocations are within your configured drift threshold.',
        },
        {
            id: 'prices',
            label: 'Price feed ready',
            ok: pricesOk,
            detail: pricesOk
                ? undefined
                : 'Some quotes are missing, cached, or degraded — confirm sizes before submitting.',
        },
        {
            id: 'trades',
            label: 'Trades planned',
            ok: tradesOk,
            detail: tradesOk ? undefined : 'No executable trades were estimated for the current book.',
        },
        {
            id: 'gas',
            label: 'Network fees within expected range',
            ok: gasOk,
            detail: gasOk ? undefined : 'Estimated fees are higher than usual for this portfolio.',
        },
    ]
}

export const useUserPortfolios = (address: string | null) => {
    return useQuery({
        queryKey: portfolioKeys.list(address || ''),
        queryFn: async () => {
            const res = await api.get<{ portfolios: any[] }>(ENDPOINTS.USER_PORTFOLIOS(address!))
            return res.portfolios
        },
        enabled: !!address,
        staleTime: 60000,

    })
}

export const usePortfolioDetails = (id: string | null) => {
    return useQuery({
        queryKey: portfolioKeys.detail(id || ''),
        queryFn: () => api.get<any>(ENDPOINTS.PORTFOLIO_DETAIL(id!)),
        enabled: !!id && id !== 'demo',
        staleTime: 30000,

    })
}

export const useRebalanceEstimate = (id: string | null) => {
    return useQuery({
        queryKey: [...portfolioKeys.detail(id || ''), 'rebalance-estimate'],
        queryFn: () => api.get<any>(ENDPOINTS.PORTFOLIO_REBALANCE_ESTIMATE(id!)),
        enabled: !!id && id !== 'demo',
        refetchInterval: 30000,
        staleTime: 25000,
        refetchOnReconnect: false,
        placeholderData: (previous) => previous,
    })
}

export const useRebalancePlan = (id: string | null, enabled = true) => {
    return useQuery({
        queryKey: [...portfolioKeys.detail(id || ''), 'rebalance-plan'],
        queryFn: () => api.get<RebalancePlanSnapshot>(ENDPOINTS.PORTFOLIO_REBALANCE_PLAN(id!)),
        enabled: enabled && !!id && id !== 'demo',
        staleTime: 25000,
        placeholderData: (previous) => previous,
    })
}
