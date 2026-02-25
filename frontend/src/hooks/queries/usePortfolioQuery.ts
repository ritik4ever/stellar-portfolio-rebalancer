import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export const portfolioKeys = {
    all: ['portfolios'] as const,
    lists: () => [...portfolioKeys.all, 'list'] as const,
    list: (address: string) => [...portfolioKeys.lists(), address] as const,
    details: () => [...portfolioKeys.all, 'detail'] as const,
    detail: (id: string) => [...portfolioKeys.details(), id] as const,
}

export const useUserPortfolios = (address: string | null) => {
    return useQuery({
        queryKey: portfolioKeys.list(address || ''),
        queryFn: () => api.get<any[]>(ENDPOINTS.USER_PORTFOLIOS(address!)),
        enabled: !!address,
        staleTime: 60000, // 1 minute
    })
}

export const usePortfolioDetails = (id: string | null) => {
    return useQuery({
        queryKey: portfolioKeys.detail(id || ''),
        queryFn: () => api.get<any>(ENDPOINTS.PORTFOLIO_DETAIL(id!)),
        enabled: !!id && id !== 'demo',
        staleTime: 30000, // 30 seconds
    })
}
