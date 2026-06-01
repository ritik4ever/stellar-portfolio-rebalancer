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
    })
}
