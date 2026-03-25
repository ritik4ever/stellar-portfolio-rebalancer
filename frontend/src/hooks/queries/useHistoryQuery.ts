import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export const historyKeys = {
    all: ['history'] as const,
    list: (portfolioId?: string) => [...historyKeys.all, { portfolioId }] as const,
}

export const useRebalanceHistory = (portfolioId?: string | null) => {
    return useQuery({
        queryKey: historyKeys.list(portfolioId || undefined),
        queryFn: () => {
            let url = ENDPOINTS.REBALANCE_HISTORY
            if (portfolioId && portfolioId !== 'demo') {
                url += `?portfolioId=${portfolioId}`
            }
            return api.get<any>(url)
        },
        refetchInterval: 30000, // Refresh every 30 seconds
        staleTime: 25000,
    })
}
