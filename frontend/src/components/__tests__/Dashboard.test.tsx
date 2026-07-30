import React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'

// Mock the hooks used by Dashboard to control returned data
vi.mock('../../hooks/queries/usePortfolioQuery', () => ({
  useUserPortfolios: (publicKey: string | null) => ({ data: [], isLoading: false, isError: false, error: null }),
  usePortfolioDetails: () => ({ data: null, isLoading: false, isError: false, error: null }),
  useRebalanceEstimate: () => ({ data: null }),
  useRebalancePlan: () => ({ data: null, isLoading: false, isError: false }),
  usePortfolioCostSummary: () => ({ data: null, isLoading: false }),
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

vi.mock('../ThemeContext', () => ({
  useTheme: vi.fn(() => ({ isDark: false })),
}))
vi.mock('../ThemeToggle', () => ({ default: () => <div>Theme Toggle</div> }))
vi.mock('../LanguageSelector', () => ({ default: () => <div>Language Selector</div> }))
vi.mock('../AssetList', () => ({
  default: ({ assets }: { assets?: Array<{ name: string }> }) => (
    <div>{assets?.map((a) => <div key={a.name}>Asset Card {a.name}</div>) ?? null}</div>
  ),
}))
vi.mock('../AssetCard', () => ({
  default: ({ asset }: { asset?: { name?: string } }) => <div>Asset Card {asset?.name ?? 'Unknown'}</div>,
}))
vi.mock('../RebalanceHistory', () => ({ default: () => <div>Rebalance History</div> }))
vi.mock('../PerformanceChart', () => ({ default: () => <div>Performance Chart</div> }))
vi.mock('../AllocationHistory', () => ({ default: () => <div>Allocation History</div> }))
vi.mock('../NotificationPreferences', () => ({ default: () => <div>Notification Preferences</div> }))
vi.mock('../PriceTracker', () => ({ default: () => <div>Price Tracker</div> }))
vi.mock('../MarketMovers', () => ({ MarketMovers: () => <div>Market Movers</div> }))
vi.mock('../RouteErrorState', () => ({ default: () => <div>Route Error State</div> }))
vi.mock('../../hooks/usePortfolioLiveFeed', () => ({
  usePortfolioLiveFeed: vi.fn(() => ({ state: 'disconnected', events: [] })),
}))
vi.mock('../../utils/stellar', () => ({
  StellarWallet: { getWalletType: vi.fn(() => 'freighter'), disconnect: vi.fn() },
}))
vi.mock('../../services/authService', () => ({
  logout: vi.fn(async () => undefined),
}))
vi.mock('../../utils/export', () => ({
  downloadCSV: vi.fn(), downloadJSON: vi.fn(), toCSV: vi.fn(() => ''),
}))
vi.mock('../../config/api', async () => {
  const actual = await vi.importActual<typeof import('../../config/api')>('../../config/api')
  return {
    ...actual,
    API_CONFIG: { ...actual.API_CONFIG, USE_BROWSER_PRICES: false },
    api: { delete: vi.fn(async () => undefined) },
    downloadPortfolioExport: vi.fn(async () => undefined),
  }
})
vi.mock('../../hooks/usePortfolio', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/usePortfolio')>('../../hooks/usePortfolio')
  return {
    ...actual,
    usePortfolioExport: () => ({
      exportProgress: { phase: 'idle', label: '' },
      resetExportProgress: vi.fn(),
      exportClientCsv: vi.fn(async () => undefined),
      exportClientJson: vi.fn(async () => undefined),
      exportFromServer: vi.fn(async () => undefined),
    }),
  }
})

import Dashboard from '../Dashboard'

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('Dashboard empty state', () => {
  it('shows no-portfolios empty state for connected user with no portfolios', () => {
    renderWithProviders(<Dashboard onNavigate={() => {}} publicKey={'GABC1234'} />)
    expect(screen.getByRole('button', { name: /Create Portfolio/i })).toBeTruthy()
  })
})
