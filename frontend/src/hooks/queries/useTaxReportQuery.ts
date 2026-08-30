import { useQuery } from '@tanstack/react-query'
import { api, ENDPOINTS } from '../../config/api'

export const taxReportKeys = {
    all: ['tax-report'] as const,
    year: (year: number) => [...taxReportKeys.all, year] as const,
}

export type TaxReportEntry = {
    asset: string
    date: string
    type: 'buy' | 'sell'
    amount: number
    price: number
    costBasis: number
    realizedGainLoss: number
}

export type TaxReportSummary = {
    taxYear: number
    totalRealizedGainLoss: number
    totalTrades: number
    entries: TaxReportEntry[]
    methodology: string
}

export const useTaxReportQuery = (year: number | null) => {
    return useQuery({
        queryKey: taxReportKeys.year(year ?? new Date().getFullYear()),
        queryFn: () => api.get<TaxReportSummary>(ENDPOINTS.TAX_REPORT(year ?? undefined)),
        enabled: year != null,
        staleTime: 60000,
    })
}
