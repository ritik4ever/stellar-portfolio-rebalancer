import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export const marketMoversKeys = {
    all: ['market-movers'] as const,
}

export interface MarketMover {
    symbol: string
    name: string
    price: number
    change24h: number
}

export interface MarketMoversData {
    gainers: MarketMover[]
    losers: MarketMover[]
}

export const useMarketMovers = () => {
    return useQuery<MarketMoversData>({
        queryKey: marketMoversKeys.all,
        queryFn: async () => {
            return await api.get<MarketMoversData>(ENDPOINTS.MARKET_MOVERS)
        },
        refetchInterval: 300000, // 5 minutes
        staleTime: 290000,
    })
}
