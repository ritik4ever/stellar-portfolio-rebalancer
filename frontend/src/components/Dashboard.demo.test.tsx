import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from './Dashboard'

const testDoubles = vi.hoisted(() => ({
    useUserPortfolios: vi.fn(),
    usePortfolioDetails: vi.fn(),
    useRebalanceEstimate: vi.fn(),
    useRebalancePlan: vi.fn(),
    usePrices: vi.fn(),
    useExecuteRebalanceMutation: vi.fn(),
    invalidateQueries: vi.fn(async () => undefined),
    walletGetType: vi.fn(() => 'freighter'),
    walletDisconnect: vi.fn(),
    authLogout: vi.fn(async () => undefined),
    apiGet: vi.fn(async () => ({ assets: [] })),
    apiDelete: vi.fn(async () => undefined),
}))

vi.mock('../hooks/queries/usePortfolioQuery', async importOriginal => ({
    ...await importOriginal<typeof import('../hooks/queries/usePortfolioQuery')>(),
    usePortfolioCostSummary: () => ({ data: null, isLoading: false }),
    useUserPortfolios: testDoubles.useUserPortfolios,
    usePortfolioDetails: testDoubles.usePortfolioDetails,
    useRebalanceEstimate: testDoubles.useRebalanceEstimate,
    useRebalancePlan: testDoubles.useRebalancePlan,
    portfolioKeys: { all: ['portfolios'] },
}))

vi.mock('../hooks/queries/usePricesQuery', () => ({
    usePrices: testDoubles.usePrices,
    formatPriceFeedSummary: vi.fn(() => 'Live prices'),
    priceKeys: { all: ['prices'] },
}))

vi.mock('../hooks/mutations/usePortfolioMutations', () => ({
    useExecuteRebalanceMutation: testDoubles.useExecuteRebalanceMutation,
}))

vi.mock('../context/ThemeContext', () => ({
    useTheme: vi.fn(() => ({ isDark: false })),
}))

vi.mock('@tanstack/react-query', async importOriginal => ({
    ...await importOriginal<typeof import('@tanstack/react-query')>(),
    useQueryClient: vi.fn(() => ({
        invalidateQueries: testDoubles.invalidateQueries,
    })),
}))

vi.mock('../hooks/usePortfolioLiveFeed', () => ({
    usePortfolioLiveFeed: () => ({ connectionState: 'closed' }),
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

vi.mock('./AssetList', () => ({
    default: ({ assets, isLoading }: { assets: { name: string }[]; isLoading?: boolean }) =>
        isLoading
            ? <div>Asset Card Skeleton</div>
            : assets.map(asset => <div key={asset.name}>Asset Card {asset.name}</div>),
}))
vi.mock('./RebalanceHistory', () => ({ default: () => <div>Rebalance History</div> }))
vi.mock('./PerformanceChart', () => ({ default: () => <div>Performance Chart</div> }))
vi.mock('./NotificationPreferences', () => ({ default: () => <div>Notification Preferences</div> }))
vi.mock('./PriceTracker', () => ({ default: () => <div>Price Tracker</div> }))

vi.mock('../utils/stellar', () => ({
    StellarWallet: {
        getWalletType: testDoubles.walletGetType,
        disconnect: testDoubles.walletDisconnect,
    },
}))

vi.mock('../services/authService', () => ({
    logout: testDoubles.authLogout,
}))

vi.mock('../config/api', async () => {
    const actual = await vi.importActual<typeof import('../config/api')>('../config/api')
    return {
        ...actual,
        API_CONFIG: { ...actual.API_CONFIG, USE_BROWSER_PRICES: false },
        api: { get: testDoubles.apiGet, delete: testDoubles.apiDelete },
        downloadPortfolioExport: vi.fn(async () => undefined),
    }
})

function renderDashboard(ui: React.ReactElement) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return render(ui, {
        wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    })
}

describe('Dashboard demo mode and wallet switching (SPR-2026-085)', () => {
    beforeEach(() => {
        cleanup()
        vi.restoreAllMocks()

        testDoubles.useUserPortfolios.mockReset()
        testDoubles.usePortfolioDetails.mockReset()
        testDoubles.useRebalanceEstimate.mockReset()
        testDoubles.useRebalancePlan.mockReset()
        testDoubles.usePrices.mockReset()
        testDoubles.useExecuteRebalanceMutation.mockReset()
        testDoubles.invalidateQueries.mockReset()
        testDoubles.walletGetType.mockReset()
        testDoubles.walletDisconnect.mockReset()
        testDoubles.authLogout.mockReset()
        testDoubles.apiGet.mockReset()
        testDoubles.apiDelete.mockReset()

        testDoubles.useUserPortfolios.mockReturnValue({ data: [], isLoading: false, isError: false })
        testDoubles.usePortfolioDetails.mockReturnValue({ data: null, isLoading: false, isError: false })
        testDoubles.useRebalanceEstimate.mockReturnValue({ data: null, isLoading: false })
        testDoubles.useRebalancePlan.mockReturnValue({ data: null, isLoading: false, isError: false })
        testDoubles.usePrices.mockReturnValue({ data: { prices: {}, feedMeta: null }, isLoading: false })
        testDoubles.useExecuteRebalanceMutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
        testDoubles.invalidateQueries.mockResolvedValue(undefined)
        testDoubles.walletGetType.mockReturnValue('freighter')
        testDoubles.authLogout.mockResolvedValue(undefined)
        testDoubles.apiGet.mockResolvedValue({ assets: [] })
        testDoubles.apiDelete.mockResolvedValue(undefined)
    })

    it('keeps demo and real balances strictly separated when switching between demo mode and a connected wallet', async () => {
        const onNavigate = vi.fn()
        const view = renderDashboard(<Dashboard onNavigate={onNavigate} publicKey={null} />)

        // 1. Demo mode state: simulated balances and demo assets only
        expect(await screen.findByText('Demo balance')).toBeInTheDocument()
        expect(screen.getByText('Simulated $10,000')).toBeInTheDocument()
        expect(screen.getByText('Asset Card XLM')).toBeInTheDocument()
        expect(screen.getByText('Asset Card USDC')).toBeInTheDocument()
        expect(screen.queryByText('Wallet balance')).not.toBeInTheDocument()
        expect(screen.getAllByRole('button', { name: /reset demo portfolio/i }).length).toBeGreaterThanOrEqual(1)

        // 2. Switch to connected wallet with real portfolio balances
        const connectedKey = 'GABCD1234567890TEST'
        testDoubles.useUserPortfolios.mockReturnValue({
            data: [{
                id: 'live-portfolio-1',
                totalValue: 42500,
                dayChange: 2.4,
                allocations: [
                    { asset: 'BTC', target: 50, amount: 21250 },
                    { asset: 'ETH', target: 50, amount: 21250 },
                ],
            }],
            isLoading: false,
            isError: false,
        })
        testDoubles.usePortfolioDetails.mockReturnValue({
            data: {
                id: 'live-portfolio-1',
                totalValue: 42500,
                dayChange: 2.4,
                allocations: [
                    { asset: 'BTC', target: 50, amount: 21250 },
                    { asset: 'ETH', target: 50, amount: 21250 },
                ],
            },
            isLoading: false,
            isError: false,
        })

        view.rerender(<Dashboard onNavigate={onNavigate} publicKey={connectedKey} />)

        expect(await screen.findByText('Wallet balance')).toBeInTheDocument()
        // The total shows in the header summary and again in the mobile action bar.
        expect(screen.getAllByText('$42,500').length).toBeGreaterThan(0)
        expect(screen.getByText(/GABC\.\.\.TEST/)).toBeInTheDocument()
        expect(screen.getByText('Asset Card BTC')).toBeInTheDocument()
        expect(screen.getByText('Asset Card ETH')).toBeInTheDocument()

        // Demo indicators and demo assets must not leak into connected wallet view
        expect(screen.queryByText('Demo balance')).not.toBeInTheDocument()
        expect(screen.queryByText('Simulated $10,000')).not.toBeInTheDocument()
        expect(screen.queryByText('Asset Card XLM')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /reset demo portfolio/i })).not.toBeInTheDocument()
        expect(testDoubles.useUserPortfolios).toHaveBeenCalledWith(connectedKey)

        // 3. Disconnect wallet via isolated wallet & auth doubles
        fireEvent.click(screen.getByRole('button', { name: /disconnect/i }))
        await waitFor(() => {
            expect(testDoubles.authLogout).toHaveBeenCalledWith(connectedKey)
            expect(testDoubles.walletDisconnect).toHaveBeenCalledTimes(1)
            expect(onNavigate).toHaveBeenCalledWith('landing')
        })

        // 4. Switch back to demo mode — real balances must not leak into demo view
        testDoubles.useUserPortfolios.mockReturnValue({ data: [], isLoading: false, isError: false })
        testDoubles.usePortfolioDetails.mockReturnValue({ data: null, isLoading: false, isError: false })
        view.rerender(<Dashboard onNavigate={onNavigate} publicKey={null} />)

        expect(await screen.findByText('Demo balance')).toBeInTheDocument()
        expect(screen.getByText('Simulated $10,000')).toBeInTheDocument()
        expect(screen.queryByText('Wallet balance')).not.toBeInTheDocument()
        expect(screen.queryByText('$42,500')).not.toBeInTheDocument()
        expect(screen.queryByText('Asset Card BTC')).not.toBeInTheDocument()
    })

    it('does not fall back to demo balances when a connected wallet has no saved portfolios', async () => {
        renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GEMPTY1234567890TEST" />)

        expect(await screen.findByRole('button', { name: /create portfolio/i })).toBeInTheDocument()
        expect(screen.queryByText('Demo balance')).not.toBeInTheDocument()
        expect(screen.queryByText('Simulated $10,000')).not.toBeInTheDocument()
    })

    it('recovers from a halfway demo reset failure without duplicating already-completed steps', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        let priceCalls = 0
        testDoubles.invalidateQueries.mockImplementation(async ({ queryKey }: { queryKey: string[] }) => {
            if (queryKey[0] === 'prices') {
                priceCalls += 1
                if (priceCalls === 1) {
                    throw new Error('Price feed timeout')
                }
            }
        })

        renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)

        fireEvent.click((await screen.findAllByRole('button', { name: /reset demo portfolio/i }))[0])
        fireEvent.click(screen.getByRole('button', { name: /^Reset Demo$/i }))

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent(/stopped halfway while refreshing demo price data/i)
        expect(alert).toHaveTextContent(/will not be duplicated/i)
        expect(alert).toHaveTextContent(/Price feed timeout/i)

        // Retry only the remaining failed step
        fireEvent.click(screen.getByRole('button', { name: /retry remaining steps/i }))

        await waitFor(() => {
            expect(screen.queryByRole('heading', { name: 'Reset Demo Portfolio' })).not.toBeInTheDocument()
        })

        const invalidatedKeys = testDoubles.invalidateQueries.mock.calls.map(call => call[0]?.queryKey?.[0])
        expect(invalidatedKeys).toEqual(['portfolios', 'prices', 'prices'])
        expect(screen.getByText('Demo balance')).toBeInTheDocument()

        consoleError.mockRestore()
    })

    it('prevents duplicate demo reset submissions while a reset is already in flight', async () => {
        let resolvePortfolios!: () => void
        const portfoliosPromise = new Promise<void>(resolve => {
            resolvePortfolios = resolve
        })

        testDoubles.invalidateQueries.mockImplementation(async ({ queryKey }: { queryKey: string[] }) => {
            if (queryKey[0] === 'portfolios') {
                await portfoliosPromise
            }
        })

        renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)

        fireEvent.click((await screen.findAllByRole('button', { name: /reset demo portfolio/i }))[0])
        const confirmButton = screen.getByRole('button', { name: /^Reset Demo$/i })

        // Rapid double-click while first submission is in-flight
        fireEvent.click(confirmButton)
        fireEvent.click(confirmButton)

        // aria-disabled (not `disabled`) so keyboard focus is not dropped mid-reset.
        expect(confirmButton).toHaveAttribute('aria-disabled', 'true')
        expect(confirmButton).toHaveTextContent(/resetting/i)
        expect(testDoubles.invalidateQueries).toHaveBeenCalledTimes(1)

        resolvePortfolios()

        await waitFor(() => {
            expect(screen.queryByRole('heading', { name: 'Reset Demo Portfolio' })).not.toBeInTheDocument()
        })

        const invalidatedKeys = testDoubles.invalidateQueries.mock.calls.map(call => call[0]?.queryKey?.[0])
        expect(invalidatedKeys).toEqual(['portfolios', 'prices'])
    })

    it('recovers cleanly when demo reset fails on the first step and user retries', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        testDoubles.invalidateQueries.mockRejectedValueOnce(new Error('Portfolio store unavailable'))

        renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)

        fireEvent.click((await screen.findAllByRole('button', { name: /reset demo portfolio/i }))[0])
        fireEvent.click(screen.getByRole('button', { name: /^Reset Demo$/i }))

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent(/failed while resetting demo portfolio data/i)
        expect(alert).toHaveTextContent(/Portfolio store unavailable/i)

        fireEvent.click(screen.getByRole('button', { name: /retry reset/i }))

        await waitFor(() => {
            expect(screen.queryByRole('heading', { name: 'Reset Demo Portfolio' })).not.toBeInTheDocument()
        })

        const invalidatedKeys = testDoubles.invalidateQueries.mock.calls.map(call => call[0]?.queryKey?.[0])
        expect(invalidatedKeys).toEqual(['portfolios', 'portfolios', 'prices'])

        consoleError.mockRestore()
    })
})
