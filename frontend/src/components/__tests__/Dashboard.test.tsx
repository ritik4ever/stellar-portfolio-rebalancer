import React from 'react'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock the hooks used by Dashboard to control returned data
vi.mock('../../hooks/queries/usePortfolioQuery', () => ({
  useUserPortfolios: (publicKey: string | null) => ({ data: [], isLoading: false, isError: false, error: null }),
  usePortfolioDetails: () => ({ data: null, isLoading: false, isError: false, error: null }),
  useRebalanceEstimate: () => ({ data: null }),
  usePortfolioCostSummary: () => ({ data: null, isLoading: false }),
  useRebalancePlan: () => ({ data: null, isLoading: false, isError: false }),
  buildRebalanceConfirmationSummary: () => ({ slippage: [], prices: [], risks: [] }),
  buildRebalancePreconditions: () => [],
  portfolioKeys: { all: ['portfolios'] }
}))

vi.mock('../../hooks/queries/usePricesQuery', () => ({
  usePrices: () => ({ data: null, isLoading: false, isError: false }),
  priceKeys: { all: ['prices'] },
  formatPriceFeedSummary: () => 'No price data'
}))

vi.mock('../../hooks/mutations/usePortfolioMutations', () => ({
  useExecuteRebalanceMutation: () => ({ mutateAsync: async () => ({}) })
}))

vi.mock('../../context/RealtimeConnectionContext', () => ({
  useRealtimeConnection: () => ({ status: 'connected', isConnected: true }),
  RealtimeConnectionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

import Dashboard from '../Dashboard'

describe('Dashboard empty state', () => {
  it('shows no-portfolios empty state for connected user with no portfolios', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <Dashboard onNavigate={() => {}} publicKey={'GABC1234'} />
      </QueryClientProvider>
    )
    expect(screen.getByText(/No portfolios yet/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create Portfolio/i })).toBeTruthy()
  })
})
