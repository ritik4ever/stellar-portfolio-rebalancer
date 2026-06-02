import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export const historyKeys = {
    all: ['history'] as const,
    list: (portfolioId?: string, page?: number, limit?: number, search?: string, status?: string, trigger?: string, date?: string) => [...historyKeys.all, { portfolioId, page, limit, search, status, trigger, date }] as const,
}

export const useRebalanceHistory = (portfolioId?: string | null, page: number = 1, limit: number = 10, search?: string, status?: string, trigger?: string, date?: string) => {
    return useQuery({
        queryKey: historyKeys.list(portfolioId || undefined, page, limit, search, status, trigger, date),
        queryFn: () => {
            let url = ENDPOINTS.REBALANCE_HISTORY
            const params: Record<string, string> = {
                page: page.toString(),
                limit: limit.toString()
            }
            if (portfolioId && portfolioId !== 'demo') params.portfolioId = portfolioId
            if (search) params.search = search
            if (status) params.status = status
            if (trigger) params.trigger = trigger
            if (date) params.date = date
            return api.get<any>(url, params)
        },
        refetchInterval: 30000, // Refresh every 30 seconds
        staleTime: 25000,
    })
}
