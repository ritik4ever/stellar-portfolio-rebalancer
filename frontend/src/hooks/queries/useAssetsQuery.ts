import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export const assetKeys = {
    all: ['assets'] as const,
}

interface Asset {
    symbol: string
}

export const useAssets = () => {
    return useQuery({
        queryKey: assetKeys.all,
        queryFn: async () => {
            const res = await api.get<{ assets: Asset[] }>(ENDPOINTS.ASSETS)
            return res?.assets?.map((a) => a.symbol) ?? ['XLM', 'BTC', 'ETH', 'USDC']
        },
        staleTime: 300000, // 5 minutes — asset list rarely changes
        placeholderData: ['XLM', 'BTC', 'ETH', 'USDC'],
    })
}
