import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'
import { portfolioKeys } from '../queries/usePortfolioQuery'
import { historyKeys } from '../queries/useHistoryQuery'
import { analyticsKeys } from '../queries/useAnalyticsQuery'

export const useCreatePortfolioMutation = () => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: (data: any) => api.post<any>(ENDPOINTS.PORTFOLIO, data),
        onSuccess: () => {
            // Invalidate relevant user lists
            queryClient.invalidateQueries({ queryKey: portfolioKeys.all })
        },
    })
}

export const useExecuteRebalanceMutation = (portfolioId: string | null) => {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: () => api.post<any>(ENDPOINTS.PORTFOLIO_REBALANCE(portfolioId!)),
        onSuccess: () => {
            // Invalidate the specific portfolio details and history
            if (portfolioId) {
                queryClient.invalidateQueries({ queryKey: portfolioKeys.detail(portfolioId) })
                queryClient.invalidateQueries({ queryKey: historyKeys.list(portfolioId) })
                queryClient.invalidateQueries({ queryKey: analyticsKeys.portfolio(portfolioId) })
            }
        },
    })
}
