import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from './Dashboard'
import { ApiClientError } from '../config/api'

// Dashboard calls useQueryClient() directly, so every render needs a provider.
const renderWithClient = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    })
    return render(ui, { wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider> })
}

const queryMocks = vi.hoisted(() => ({
    useUserPortfolios: vi.fn(),
    usePortfolioDetails: vi.fn(),
    useRebalanceEstimate: vi.fn(),
    useRebalancePlan: vi.fn(),
    usePrices: vi.fn(),
    useExecuteRebalanceMutation: vi.fn(),
    invalidateQueries: vi.fn(async () => undefined),
}))

vi.mock('../hooks/queries/usePortfolioQuery', async importOriginal => ({
    ...await importOriginal<typeof import('../hooks/queries/usePortfolioQuery')>(),
    usePortfolioCostSummary: () => ({ data: null, isLoading: false }),
    useUserPortfolios: queryMocks.useUserPortfolios,
    usePortfolioDetails: queryMocks.usePortfolioDetails,
    useRebalanceEstimate: queryMocks.useRebalanceEstimate,
    useRebalancePlan: queryMocks.useRebalancePlan,
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
    priceKeys: { all: ['prices'] },
}))

vi.mock('../hooks/mutations/usePortfolioMutations', () => ({
    useExecuteRebalanceMutation: queryMocks.useExecuteRebalanceMutation,
}))

vi.mock('../context/ThemeContext', () => ({
    useTheme: vi.fn(() => ({ isDark: false })),
}))
vi.mock('@tanstack/react-query', async importOriginal => ({
    ...await importOriginal<typeof import('@tanstack/react-query')>(),
    useQueryClient: vi.fn(() => ({
        invalidateQueries: queryMocks.invalidateQueries,
    })),
}))

vi.mock('../hooks/usePortfolioLiveFeed', () => ({ usePortfolioLiveFeed: () => ({ connectionState: 'closed' }) }))
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
vi.mock('./AssetList', () => ({
    default: ({ assets, isLoading }: { assets: { name: string }[]; isLoading?: boolean }) =>
        isLoading ? <div>Asset Card Skeleton</div> : assets.map(asset => <div key={asset.name}>Asset Card {asset.name}</div>)
}))
vi.mock('./RebalanceHistory', () => ({
    default: ({ isLoading }: { isLoading?: boolean }) =>
        isLoading ? <div>Rebalance History Skeleton</div> : <div>Rebalance History</div>
}))
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
        api: { get: vi.fn(async () => ({ assets: [] })), delete: vi.fn(async () => undefined) },
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
        queryMocks.invalidateQueries.mockReset()
        queryMocks.invalidateQueries.mockResolvedValue(undefined)
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
        expect(dayChange.className).toContain('text-green-600')
        expect(dayChange.className).toContain('dark:text-green-400')
        // Regression guard: the old ~1.9:1 token must not return.
        expect(dayChange.className).not.toMatch(/(^|\s)text-green-500(\s|$)/)
    })

    it('renders loading state while portfolio data is fetching', async () => {
        queryMocks.useUserPortfolios.mockReturnValue({ data: undefined, isLoading: true })
        queryMocks.usePrices.mockReturnValue({ data: undefined, isLoading: true })

        renderWithClient(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

        expect(await screen.findByRole('status')).toHaveTextContent('Loading portfolio data')
    })

    it('opens rebalance preview before confirming manual rebalance', async () => {
        queryMocks.useUserPortfolios.mockReturnValue({
            data: [{
                id: 'p-1',
                totalValue: 5000,
                needsRebalance: true,
                allocations: [
                    { asset: 'XLM', target: 60, amount: 3000 },
                    { asset: 'USDC', target: 40, amount: 2000 },
                ],
            }],
            isLoading: false,
            isError: false,
        })
        queryMocks.usePortfolioDetails.mockReturnValue({
            data: {
                id: 'p-1',
                needsRebalance: true,
                slippageTolerancePercent: 2,
                allocations: [
                    { asset: 'XLM', target: 60, amount: 3000 },
                    { asset: 'USDC', target: 40, amount: 2000 },
                ],
            },
            isLoading: false,
            isError: false,
        })
        queryMocks.useRebalancePlan.mockReturnValue({
            data: {
                maxSlippagePercent: 2,
                estimatedFees: { xlm: 0.02, usd: 0.01, tradeCount: 1 },
                boundary: {
                    trades: [{ asset: 'XLM', action: 'buy', amount: 10 }],
                    quoteSnapshot: { feedMeta: {}, prices: { XLM: { timestamp: 1791648000 } } },
                },
            },
        })
        queryMocks.usePrices.mockReturnValue({
            data: {
                prices: { XLM: { price: 0.12, change: 1.1 }, USDC: { price: 1, change: 0 } },
                feedMeta: null,
            },
            isLoading: false,
        })

        renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

        const review = await screen.findByRole('button', { name: 'Review rebalance' })
        review.focus()
        fireEvent.click(review)
        const dialog = await screen.findByRole('dialog')
        expect(dialog).toHaveFocus()
        expect(within(dialog).getByRole('heading', { name: '1 planned trade' })).toBeInTheDocument()
        expect(within(dialog).getByRole('button', { name: 'Confirm rebalance' })).toBeDisabled()
        fireEvent.keyDown(dialog, { key: 'Escape' })
        expect(review).toHaveFocus()
    })

    it.each([403, 404])('focuses recovery when portfolio details return %s', async (status) => {
        queryMocks.useUserPortfolios.mockReturnValue({ data: [{ id: 'p-1' }], isLoading: false })
        queryMocks.usePortfolioDetails.mockReturnValue({
            isError: true, error: new ApiClientError('Unavailable', status, 'UNAVAILABLE'),
        })
        const onNavigate = vi.fn()
        renderWithClient(<Dashboard onNavigate={onNavigate} publicKey="GTEST" />)
        expect(await screen.findByRole('heading', { name: 'Portfolio unavailable' })).toHaveFocus()
        expect(screen.getByRole('button', { name: 'Reload portfolio list' })).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Go to landing' }))
        expect(onNavigate).toHaveBeenCalledWith('landing')
    })

    it('announces an unavailable balance while showing target allocations and supports retry', async () => {
        const refetch = vi.fn().mockResolvedValue({ isSuccess: false })
        queryMocks.useUserPortfolios.mockReturnValue({
            data: [{ id: 'p-1', allocations: { XLM: 60, USDC: 40 } }], isLoading: false,
        })
        queryMocks.usePortfolioDetails.mockReturnValue({ isLoading: true })
        const view = renderWithClient(<Dashboard onNavigate={vi.fn()} publicKey="GTEST" />)
        expect(await screen.findByText(/Loading portfolio balances/)).toBeInTheDocument()
        queryMocks.usePortfolioDetails.mockReturnValue({
            isError: true, error: new Error('Balances failed'), refetch,
        })
        view.rerender(<Dashboard onNavigate={vi.fn()} publicKey="GTEST" />)
        expect((await screen.findByText(/Portfolio balances are unavailable/)).closest('[role=status]')).toBeInTheDocument()
        expect(screen.getByText('60%')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: 'Retry loading balances' }))
        expect(refetch).toHaveBeenCalledOnce()
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

    it('displays distinct demo mode indicators, simulated values, and operable reset modal at narrow widths', async () => {
        queryMocks.useUserPortfolios.mockReturnValue({ data: [], isLoading: false })
        queryMocks.usePortfolioDetails.mockReturnValue({
            data: { id: 'demo', totalValue: 10000, dayChange: 0, assets: [] },
            isLoading: false,
        })
        queryMocks.usePrices.mockReturnValue({ data: { prices: {}, feedMeta: null }, isLoading: false })

        renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)

        // Clear separation of demo mode
        expect(await screen.findByText('Demo balance')).toBeInTheDocument()
        expect(screen.getByText('Simulated $10,000')).toBeInTheDocument()

        // Demo controls visible and operable
        const resetButtons = screen.getAllByRole('button', { name: /reset demo portfolio/i })
        expect(resetButtons.length).toBeGreaterThanOrEqual(1)

        // Open demo reset modal
        fireEvent.click(resetButtons[0])
        expect(screen.getByRole('heading', { name: 'Reset Demo Portfolio' })).toBeInTheDocument()
        expect(screen.getByText(/Real wallet balances and on-chain portfolios are not affected\./i)).toBeInTheDocument()

        // Cancel modal
        const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
        fireEvent.click(cancelBtn)
        expect(screen.queryByRole('heading', { name: 'Reset Demo Portfolio' })).not.toBeInTheDocument()
    })

    it('displays distinct wallet balance badge and address when wallet is connected', async () => {
        queryMocks.useUserPortfolios.mockReturnValue({ data: [{ id: 'live-1', name: 'Main' }], isLoading: false })
        queryMocks.usePortfolioDetails.mockReturnValue({
            data: { id: 'live-1', totalValue: 25000, dayChange: 1.5, assets: [] },
            isLoading: false,
        })
        queryMocks.usePrices.mockReturnValue({ data: { prices: {}, feedMeta: null }, isLoading: false })

        renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GABCD1234567890TEST" />)

        // Live wallet balance badge is displayed
        expect(await screen.findByText('Wallet balance')).toBeInTheDocument()
        expect(screen.queryByText('Demo balance')).not.toBeInTheDocument()
        expect(screen.queryByText('Simulated $10,000')).not.toBeInTheDocument()

        // Shows connected wallet header details
        expect(screen.getByText(/GABC\.\.\.TEST/)).toBeInTheDocument()
    })

    it('recovers from a halfway demo reset failure without duplicating completed steps', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined)

        let priceAttempts = 0
        queryMocks.invalidateQueries.mockImplementation(async ({ queryKey }: { queryKey: string[] }) => {
            if (queryKey[0] === 'prices') {
                priceAttempts += 1
                if (priceAttempts === 1) {
                    throw new Error('Price feed timeout')
                }
            }
        })

        renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)

        const resetButtons = await screen.findAllByRole('button', { name: /reset demo portfolio/i })
        fireEvent.click(resetButtons[0])

        fireEvent.click(screen.getByRole('button', { name: /^Reset Demo$/i }))

        const alertBanner = await screen.findByRole('alert')
        expect(alertBanner).toHaveTextContent(/stopped halfway while refreshing demo price data/i)
        expect(alertBanner).toHaveTextContent(/will not be duplicated/i)
        expect(alertBanner).toHaveTextContent(/Price feed timeout/i)
        expect(alertSpy).not.toHaveBeenCalled()

        // Step 1 ran once, step 2 ran once and failed
        expect(queryMocks.invalidateQueries).toHaveBeenCalledTimes(2)

        // Retry remaining step only — portfolios must not be invalidated again
        fireEvent.click(screen.getByRole('button', { name: /retry remaining steps/i }))

        await waitFor(() => {
            expect(screen.queryByRole('heading', { name: 'Reset Demo Portfolio' })).not.toBeInTheDocument()
        })

        const invalidatedKeys = queryMocks.invalidateQueries.mock.calls.map(call => call[0]?.queryKey?.[0])
        expect(invalidatedKeys).toEqual(['portfolios', 'prices', 'prices'])

        consoleError.mockRestore()
        alertSpy.mockRestore()
    })

    it('preserves unrelated dashboard state when canceling after a demo reset failure', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        queryMocks.invalidateQueries.mockRejectedValueOnce(new Error('Network unavailable'))

        renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)

        // Switch to Analytics tab as unrelated user state
        fireEvent.click(await screen.findByRole('button', { name: /analytics/i }))
        expect(await screen.findByText('Performance Chart')).toBeInTheDocument()

        const resetButtons = screen.getAllByRole('button', { name: /reset demo portfolio/i })
        fireEvent.click(resetButtons[0])
        fireEvent.click(screen.getByRole('button', { name: /^Reset Demo$/i }))

        expect(await screen.findByRole('alert')).toHaveTextContent(/Network unavailable/i)
        expect(screen.getByRole('button', { name: /retry reset/i })).toBeInTheDocument()

        // Cancel without refreshing the page — Analytics tab remains active
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        expect(screen.queryByRole('heading', { name: 'Reset Demo Portfolio' })).not.toBeInTheDocument()
        expect(screen.getByText('Performance Chart')).toBeInTheDocument()

        consoleError.mockRestore()
    })
})
