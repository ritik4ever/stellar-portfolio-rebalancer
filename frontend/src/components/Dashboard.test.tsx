import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import Dashboard from './Dashboard'

const queryMocks = vi.hoisted(() => ({
    useUserPortfolios: vi.fn(),
    usePortfolioDetails: vi.fn(),
    useRebalanceEstimate: vi.fn(),
    usePrices: vi.fn(),
    useExecuteRebalanceMutation: vi.fn(),
}))

vi.mock('../hooks/queries/usePortfolioQuery', () => ({
    useUserPortfolios: queryMocks.useUserPortfolios,
    usePortfolioDetails: queryMocks.usePortfolioDetails,
    useRebalanceEstimate: queryMocks.useRebalanceEstimate,
}))

vi.mock('../hooks/queries/usePricesQuery', () => ({
    usePrices: queryMocks.usePrices,
    formatPriceFeedSummary: vi.fn(() => 'Live prices'),
}))

vi.mock('../hooks/mutations/usePortfolioMutations', () => ({
    useExecuteRebalanceMutation: queryMocks.useExecuteRebalanceMutation,
}))

vi.mock('../context/ThemeContext', () => ({
    useTheme: vi.fn(() => ({ isDark: false })),
}))

vi.mock('./ThemeToggle', () => ({ default: () => <div>Theme Toggle</div> }))
vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Cell: () => <div />,
    LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Line: () => <div />,
    XAxis: () => <div />,
    YAxis: () => <div />,
    CartesianGrid: () => <div />,
    Tooltip: () => <div />,
}))
vi.mock('./AssetCard', () => ({
    default: ({ asset, isLoading }: { asset?: { name?: string }; isLoading?: boolean }) =>
        isLoading ? <div>Asset Card Skeleton</div> : <div>Asset Card {asset?.name ?? 'Unknown'}</div>
}))
vi.mock('./RebalanceHistory', () => ({ default: () => <div>Rebalance History</div> }))
vi.mock('./PerformanceChart', () => ({ default: () => <div>Performance Chart</div> }))
vi.mock('./NotificationPreferences', () => ({ default: () => <div>Notification Preferences</div> }))
vi.mock('./PriceTracker', () => ({ default: () => <div>Price Tracker</div> }))

vi.mock('../utils/stellar', () => ({
    StellarWallet: {
        getWalletType: vi.fn(() => 'freighter'),
        disconnect: vi.fn(),
    }
}))

vi.mock('../services/authService', () => ({
    logout: vi.fn(async () => undefined),
}))

vi.mock('../utils/export', () => ({
    downloadCSV: vi.fn(),
    downloadJSON: vi.fn(),
    toCSV: vi.fn(() => 'csv'),
}))

vi.mock('../config/api', async () => {
    const actual = await vi.importActual<typeof import('../config/api')>('../config/api')
    return {
        ...actual,
        API_CONFIG: { ...actual.API_CONFIG, USE_BROWSER_PRICES: false },
        api: { delete: vi.fn(async () => undefined) },
        downloadPortfolioExport: vi.fn(async () => undefined),
    }
})

class TestErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
    constructor(props: { children: React.ReactNode }) {
        super(props)
        this.state = { hasError: false }
    }

    static getDerivedStateFromError() {
        return { hasError: true }
    }

    render() {
        if (this.state.hasError) {
            return <div>Dashboard failed to load</div>
        }
        return this.props.children
    }
}

describe('Dashboard', () => {
    beforeEach(() => {
        cleanup()
        vi.restoreAllMocks()

        queryMocks.useUserPortfolios.mockReturnValue({ data: [], isLoading: false })
        queryMocks.usePortfolioDetails.mockReturnValue({ data: null, isLoading: false })
        queryMocks.useRebalanceEstimate.mockReturnValue({ data: null, isLoading: false })
        queryMocks.usePrices.mockReturnValue({ data: { prices: {}, feedMeta: null }, isLoading: false })
        queryMocks.useExecuteRebalanceMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    })

    it('renders onboarding CTA for an empty portfolio', async () => {
        render(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

        expect(await screen.findByRole('button', { name: /create portfolio/i })).toBeTruthy()
        expect(screen.getByText(/portfolio dashboard/i)).toBeTruthy()
    })

    it('renders asset cards when portfolio data is populated', async () => {
        queryMocks.useUserPortfolios.mockReturnValue({
            data: [{
                id: 'p-1',
                totalValue: 5000,
                dayChange: 1.2,
                allocations: [
                    { asset: 'XLM', target: 60, amount: 3000 },
                    { asset: 'USDC', target: 40, amount: 2000 },
                ]
            }],
            isLoading: false
        })
        queryMocks.usePrices.mockReturnValue({
            data: {
                prices: { XLM: { price: 0.12, change: 1.1 }, USDC: { price: 1, change: 0 } },
                feedMeta: null
            },
            isLoading: false
        })

        render(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

        expect(await screen.findByText('Asset Card XLM')).toBeTruthy()
        expect(screen.getByText('Asset Card USDC')).toBeTruthy()
    })

    it('renders loading state while portfolio data is fetching', async () => {
        queryMocks.useUserPortfolios.mockReturnValue({ data: undefined, isLoading: true })
        queryMocks.usePrices.mockReturnValue({ data: undefined, isLoading: true })

        render(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

        expect(await screen.findByText(/loading portfolio data/i)).toBeTruthy()
    })

    it('renders error fallback when portfolio fetching throws', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        queryMocks.useUserPortfolios.mockImplementation(() => {
            throw new Error('portfolio fetch failed')
        })

        render(
            <TestErrorBoundary>
                <Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />
            </TestErrorBoundary>
        )

        expect(await screen.findByText(/dashboard failed to load/i)).toBeTruthy()
        consoleError.mockRestore()
    })
})
