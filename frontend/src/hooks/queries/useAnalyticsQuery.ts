import { useQuery } from '@tanstack/react-query'
import { api, API_CONFIG } from '../../config/api'

export const analyticsKeys = {
    all: ['analytics'] as const,
    portfolio: (id: string) => [...analyticsKeys.all, id] as const,
    snapshots: (id: string, days: number) => [...analyticsKeys.portfolio(id), 'snapshots', { days }] as const,
    summary: (id: string) => [...analyticsKeys.portfolio(id), 'summary'] as const,
}

export const usePortfolioAnalytics = (portfolioId: string | null, days: number) => {
    return useQuery({
        queryKey: analyticsKeys.snapshots(portfolioId || '', days),
        queryFn: () => api.get<any>(`${API_CONFIG.BASE_URL}/api/portfolio/${portfolioId}/analytics?days=${days}`),
        enabled: !!portfolioId && portfolioId !== 'demo',
        staleTime: 300000, // 5 minutes
    })
}

export const usePerformanceSummary = (portfolioId: string | null) => {
    return useQuery({
        queryKey: analyticsKeys.summary(portfolioId || ''),
        queryFn: () => api.get<any>(`${API_CONFIG.BASE_URL}/api/portfolio/${portfolioId}/performance-summary`),
        enabled: !!portfolioId && portfolioId !== 'demo',
        staleTime: 60000, // 1 minute
    })
}
