import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export const historyKeys = {
    all: ['history'] as const,
    list: (portfolioId?: string, page?: number, limit?: number) => [...historyKeys.all, { portfolioId, page, limit }] as const,
}

export const useRebalanceHistory = (portfolioId?: string | null, page: number = 1, limit: number = 10) => {
    return useQuery({
        queryKey: historyKeys.list(portfolioId || undefined, page, limit),
        queryFn: () => {
            let url = ENDPOINTS.REBALANCE_HISTORY
            const params: Record<string, string> = {
                page: page.toString(),
                limit: limit.toString()
            }
            if (portfolioId && portfolioId !== 'demo') {
                params.portfolioId = portfolioId
            }
            return api.get<any>(url, params)
        },
        refetchInterval: 30000, // Refresh every 30 seconds
        staleTime: 25000,
    })
}
