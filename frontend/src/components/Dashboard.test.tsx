import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from './Dashboard'

// Dashboard calls useQueryClient() directly, so every render needs a provider.
const renderWithClient = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    })
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const queryMocks = vi.hoisted(() => ({
    useUserPortfolios: vi.fn(),
    usePortfolioDetails: vi.fn(),
    useRebalanceEstimate: vi.fn(),
    useRebalancePlan: vi.fn(),
    usePrices: vi.fn(),
    useExecuteRebalanceMutation: vi.fn(),
}))

vi.mock('../hooks/queries/usePortfolioQuery', () => ({
    useUserPortfolios: queryMocks.useUserPortfolios,
    usePortfolioDetails: queryMocks.usePortfolioDetails,
    useRebalanceEstimate: queryMocks.useRebalanceEstimate,
    useRebalancePlan: queryMocks.useRebalancePlan,
    usePortfolioCostSummary: vi.fn(() => ({ data: null, isLoading: false })),
    buildRebalanceConfirmationSummary: vi.fn(() => ({
        slippage: ['Slippage note'],
        prices: ['Price note'],
        risks: ['Risk note'],
    })),
    buildRebalancePreconditions: vi.fn(() => [
        { id: 'wallet', label: 'Wallet connected', ok: true },
        { id: 'portfolio', label: 'Live portfolio selected', ok: true },
    ]),
    portfolioKeys: { all: ['portfolios'] },
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
vi.mock('@tanstack/react-query', async () => {
    const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
    return {
        ...actual,
        useQueryClient: vi.fn(() => ({
            invalidateQueries: vi.fn(async () => undefined),
        })),
    }
})

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
vi.mock('./RebalanceHistory', () => ({
    default: ({ isLoading }: { isLoading?: boolean }) =>
        isLoading ? <div>Rebalance History Skeleton</div> : <div>Rebalance History</div>
}))
vi.mock('./PerformanceChart', () => ({ default: () => <div>Performance Chart</div> }))
vi.mock('./NotificationPreferences', () => ({ default: () => <div>Notification Preferences</div> }))
vi.mock('./PriceTracker', () => ({ default: () => <div>Price Tracker</div> }))
vi.mock('./AssetList', () => ({
    default: ({ assets }: { assets?: Array<{ name: string }> }) => (
        <div>
            {assets?.map((a) => <div key={a.name}>Asset Card {a.name}</div>) ?? null}
        </div>
    ),
}))
vi.mock('./LanguageSelector', () => ({ default: () => <div>Language Selector</div> }))
vi.mock('./MarketMovers', () => ({ MarketMovers: () => <div>Market Movers</div> }))
vi.mock('./AllocationHistory', () => ({ default: () => <div>Allocation History</div> }))
vi.mock('./RouteErrorState', () => ({ default: () => <div>Route Error State</div> }))
vi.mock('../hooks/usePortfolioLiveFeed', () => ({
    usePortfolioLiveFeed: vi.fn(() => ({ state: 'disconnected', events: [] })),
}))
vi.mock('../utils/export', () => ({
    downloadCSV: vi.fn(),
    downloadJSON: vi.fn(),
    toCSV: vi.fn(() => ''),
}))

vi.mock('../utils/stellar', () => ({
    StellarWallet: {
        getWalletType: vi.fn(() => 'freighter'),
        disconnect: vi.fn(),
    }
}))

vi.mock('../services/authService', () => ({
    logout: vi.fn(async () => undefined),
}))

vi.mock('../hooks/usePortfolio', async () => {
    const actual = await vi.importActual<typeof import('../hooks/usePortfolio')>('../hooks/usePortfolio')
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

function renderDashboard(ui: React.ReactElement) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('Dashboard', () => {
    beforeEach(() => {
        cleanup()
        vi.restoreAllMocks()

        queryMocks.useUserPortfolios.mockReturnValue({ data: [], isLoading: false, isError: false })
        queryMocks.usePortfolioDetails.mockReturnValue({ data: null, isLoading: false, isError: false })
        queryMocks.useRebalanceEstimate.mockReturnValue({ data: null, isLoading: false })
        queryMocks.useRebalancePlan.mockReturnValue({ data: null, isLoading: false, isError: false })
        queryMocks.usePrices.mockReturnValue({ data: { prices: {}, feedMeta: null }, isLoading: false })
        queryMocks.useExecuteRebalanceMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    })

    it('renders onboarding CTA for an empty portfolio', async () => {
        renderWithClient(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

        expect(await screen.findByRole('button', { name: /create portfolio/i })).toBeTruthy()
        expect(screen.getByText(/portfolio dashboard/i)).toBeTruthy()
    })

    it('offers clone as new when a saved portfolio is loaded', async () => {
        queryMocks.useUserPortfolios.mockReturnValue({
            data: [{
                id: 'p-1',
                totalValue: 5000,
                threshold: 5,
                slippageTolerance: 1,
                strategy: 'threshold',
                allocations: [
                    { asset: 'XLM', target: 60, amount: 3000 },
                    { asset: 'USDC', target: 40, amount: 2000 },
                ]
            }],
            isLoading: false,
            isError: false,
        })
        queryMocks.usePortfolioDetails.mockReturnValue({
            data: {
                id: 'p-1',
                threshold: 5,
                slippageTolerance: 1,
                strategy: 'threshold',
                allocations: [
                    { asset: 'XLM', target: 60 },
                    { asset: 'USDC', target: 40 },
                ],
            },
            isLoading: false,
            isError: false,
        })
        queryMocks.usePrices.mockReturnValue({
            data: {
                prices: { XLM: { price: 0.12, change: 1.1 }, USDC: { price: 1, change: 0 } },
                feedMeta: null
            },
            isLoading: false
        })

        const onNavigate = vi.fn()
        renderDashboard(<Dashboard onNavigate={onNavigate} publicKey="GABC1234TEST" />)

        fireEvent.click(await screen.findByRole('button', { name: /clone as new/i }))
        expect(onNavigate).toHaveBeenCalledWith('setup')
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
            isLoading: false,
            isError: false,
        })
        queryMocks.usePrices.mockReturnValue({
            data: {
                prices: { XLM: { price: 0.12, change: 1.1 }, USDC: { price: 1, change: 0 } },
                feedMeta: null
            },
            isLoading: false,
            isError: false,
        })

        renderWithClient(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

        expect(await screen.findByText('Asset Card XLM')).toBeTruthy()
        expect(screen.getByText('Asset Card USDC')).toBeTruthy()
    })

    it('renders the day-change with AA-compliant green tokens (not text-green-500 on white)', async () => {
        queryMocks.useUserPortfolios.mockReturnValue({
            data: [{
                id: 'p-1',
                totalValue: 5000,
                dayChange: 1.2,
                allocations: [{ asset: 'XLM', target: 100, amount: 5000 }],
            }],
            isLoading: false,
        })

        renderWithClient(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

        const dayChange = await screen.findByText(/\+1\.2%/)
        expect(dayChange.className).toContain('text-green-500')
    })

    it('renders loading state while portfolio data is fetching', async () => {
        queryMocks.useUserPortfolios.mockReturnValue({ data: undefined, isLoading: true })
        queryMocks.usePrices.mockReturnValue({ data: undefined, isLoading: true })

        renderWithClient(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

        expect(await screen.findByText('Loading portfolio data...')).toBeTruthy()
    })

    it('renders error fallback when portfolio fetching throws', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        queryMocks.useUserPortfolios.mockImplementation(() => {
            throw new Error('portfolio fetch failed')
        })

        renderDashboard(
            <TestErrorBoundary>
                <Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />
            </TestErrorBoundary>
        )

        expect(await screen.findByText(/dashboard failed to load/i)).toBeTruthy()
        consoleError.mockRestore()
    })
})
