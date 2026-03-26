import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export const priceKeys = {
    all: ['prices'] as const,
}

export const usePrices = () => {
    return useQuery({
        queryKey: priceKeys.all,
        queryFn: () => api.get<any>(ENDPOINTS.PRICES),
        refetchInterval: 60000, // Update every minute
        staleTime: 55000,
    })
}
