/**
 * SPR-2026-053: Rebalance history keyboard focus, accessible names, and
 * screen-reader announcements for same-timestamp events and independent
 * history page failures.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RebalanceHistory from './RebalanceHistory'
import Dashboard from './Dashboard'

// jsdom has no matchMedia; AssetList reads prefers-reduced-motion.
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
})

const mocks = vi.hoisted(() => ({
    useHistoryMock: vi.fn(),
    useUserPortfolios: vi.fn(),
    usePortfolioDetails: vi.fn(),
    useRebalanceEstimate: vi.fn(),
    useRebalancePlan: vi.fn(),
    usePortfolioCostSummary: vi.fn(),
    usePrices: vi.fn(),
    useExecuteRebalanceMutation: vi.fn(),
    downloadCsvMock: vi.fn(),
    toCsvMock: vi.fn(() => 'csv-content'),
    downloadJsonMock: vi.fn(),
    downloadBlobMock: vi.fn(),
    downloadPortfolioExportMock: vi.fn(async () => undefined),
}))

vi.mock('../hooks/queries/useHistoryQuery', () => ({
    useRebalanceHistory: mocks.useHistoryMock,
    historyKeys: { all: ['history'], list: () => ['history'] },
}))

vi.mock('../hooks/queries/usePortfolioQuery', () => ({
    useUserPortfolios: mocks.useUserPortfolios,
    usePortfolioDetails: mocks.usePortfolioDetails,
    useRebalanceEstimate: mocks.useRebalanceEstimate,
    useRebalancePlan: mocks.useRebalancePlan,
    usePortfolioCostSummary: mocks.usePortfolioCostSummary,
    isUnavailablePortfolio: vi.fn(() => false),
    portfolioKeys: { all: ['portfolios'] },
    isUnavailablePortfolio: vi.fn(() => false),
}))

vi.mock('../hooks/queries/usePricesQuery', () => ({
    usePrices: mocks.usePrices,
    formatPriceFeedSummary: vi.fn(() => 'Live prices'),
    priceKeys: { all: ['prices'] },
}))

vi.mock('../hooks/mutations/usePortfolioMutations', () => ({
    useExecuteRebalanceMutation: mocks.useExecuteRebalanceMutation,
}))

vi.mock('../hooks/usePortfolioLiveFeed', () => ({
    usePortfolioLiveFeed: vi.fn(() => ({ connectionState: 'disconnected' })),
}))

vi.mock('../context/ThemeContext', () => ({
    useTheme: vi.fn(() => ({ isDark: false })),
}))

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
    default: ({ asset }: { asset?: { name?: string } }) => <div>Asset Card {asset?.name ?? 'Unknown'}</div>,
}))
vi.mock('./PerformanceChart', () => ({ default: () => <div>Performance Chart</div> }))
vi.mock('./NotificationPreferences', () => ({ default: () => <div>Notification Preferences</div> }))
vi.mock('./PriceTracker', () => ({ default: () => <div>Price Tracker</div> }))
vi.mock('./PriceTicker', () => ({ default: () => <div>Price Ticker</div> }))
vi.mock('./ThemeToggle', () => ({ default: () => <div>Theme Toggle</div> }))
vi.mock('./LanguageSelector', () => ({ default: () => <div>Language Selector</div> }))

vi.mock('../utils/stellar', () => ({
    StellarWallet: { getWalletType: vi.fn(() => 'freighter'), disconnect: vi.fn() },
}))
vi.mock('../services/authService', () => ({ logout: vi.fn(async () => undefined) }))
vi.mock('../utils/export', () => ({
    downloadCSV: mocks.downloadCsvMock,
    downloadJSON: mocks.downloadJsonMock,
    toCSV: mocks.toCsvMock,
    downloadBlob: mocks.downloadBlobMock,
}))
vi.mock('../config/api', async () => {
    const actual = await vi.importActual<typeof import('../config/api')>('../config/api')
    return {
        ...actual,
        API_CONFIG: { ...actual.API_CONFIG, USE_BROWSER_PRICES: false },
        api: { delete: vi.fn(async () => undefined), get: vi.fn(async () => ({})) },
        downloadPortfolioExport: mocks.downloadPortfolioExportMock,
    }
})
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

const TIMESTAMP = '2026-01-01T10:00:00.000Z'

const sameTimestampEvents = [
    {
        id: 'e-first',
        timestamp: TIMESTAMP,
        trigger: 'Automatic Rebalancing',
        trades: 2,
        gasUsed: '0.02 XLM',
        status: 'completed' as const,
        portfolioId: 'p-1',
        details: { amount: 1200, fromAsset: 'XLM', toAsset: 'USDC' },
    },
    {
        id: 'e-second',
        timestamp: TIMESTAMP,
        trigger: 'Manual Rebalance',
        trades: 3,
        gasUsed: '0.03 XLM',
        status: 'failed' as const,
        portfolioId: 'p-1',
        details: { amount: 800, fromAsset: 'USDC', toAsset: 'BTC' },
    },
]

function mockPopulatedPortfolio() {
    mocks.useUserPortfolios.mockReturnValue({
        data: [{
            id: 'p-1',
            totalValue: 5000,
            dayChange: 1.2,
            needsRebalance: false,
            allocations: [
                { asset: 'XLM', target: 60, current: 60, amount: 3000 },
                { asset: 'USDC', target: 40, current: 40, amount: 2000 },
            ],
        }],
        isLoading: false,
        isError: false,
    })
    mocks.usePortfolioDetails.mockReturnValue({
        data: {
            id: 'p-1',
            threshold: 5,
            allocations: [
                { asset: 'XLM', target: 60, current: 60 },
                { asset: 'USDC', target: 40, current: 40 },
            ],
        },
        isLoading: false,
        isError: false,
    })
    mocks.useRebalanceEstimate.mockReturnValue({ data: null, isLoading: false })
    mocks.useRebalancePlan.mockReturnValue({ data: null, isLoading: false, isError: false })
    mocks.usePortfolioCostSummary.mockReturnValue({ data: null, isLoading: false })
    mocks.usePrices.mockReturnValue({
        data: {
            prices: {
                XLM: { price: 0.12, change: 1.1, timestamp: Date.parse(TIMESTAMP) / 1000 },
                USDC: { price: 1, change: 0, timestamp: Date.parse(TIMESTAMP) / 1000 },
            },
            feedMeta: null,
        },
        isLoading: false,
        isError: false,
    })
}

function renderDashboard() {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return render(
        <QueryClientProvider client={client}>
            <Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />
        </QueryClientProvider>,
    )
}

describe('RebalanceHistory accessibility (SPR-2026-053)', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockPopulatedPortfolio()
        mocks.useExecuteRebalanceMutation.mockReturnValue({
            mutateAsync: vi.fn().mockResolvedValue({ result: { gasUsed: '0 XLM' } }),
            isPending: false,
        })
    })

    it('provides distinct accessible names and keyboard focus for two events sharing a timestamp', async () => {
        mocks.useHistoryMock.mockReturnValue({
            data: { history: sameTimestampEvents, total: 2 },
            isLoading: false,
            error: null,
        })

        render(<RebalanceHistory portfolioId="p-1" />)

        const list = await screen.findByRole('list', { name: 'Rebalance history events' })
        expect(list).toBeTruthy()

        const items = screen.getAllByRole('listitem')
        expect(items).toHaveLength(2)

        const firstLabel = items[0].getAttribute('aria-label') || ''
        const secondLabel = items[1].getAttribute('aria-label') || ''
        expect(firstLabel).toContain('Event 1 of 2: Automatic Rebalancing, completed, 2 trades')
        expect(secondLabel).toContain('Event 2 of 2: Manual Rebalance, failed, 3 trades')
        expect(firstLabel).not.toBe(secondLabel)

        items[0].focus()
        expect(document.activeElement).toBe(items[0])
        items[1].focus()
        expect(document.activeElement).toBe(items[1])
    })

    it('announces independent history failure and lets a keyboard user retry or dismiss while dashboard stays usable', async () => {
        const refetch = vi.fn()
        mocks.useHistoryMock.mockReturnValue({
            data: undefined,
            isLoading: false,
            error: new Error('history unavailable'),
            refetch,
            isFetching: false,
        })

        renderDashboard()

        const alert = await screen.findByRole('alert')
        expect(alert.textContent).toContain('Failed to load rebalance history')
        expect(screen.getByText('Portfolio Value')).toBeTruthy()

        const retryBtn = screen.getByRole('button', { name: 'Retry loading rebalance history' })
        retryBtn.focus()
        expect(document.activeElement).toBe(retryBtn)
        fireEvent.click(retryBtn)
        expect(refetch).toHaveBeenCalledTimes(1)
        expect(screen.getByText('Retrying rebalance history request.')).toBeTruthy()

        const dismissBtn = screen.getByRole('button', { name: 'Dismiss rebalance history error' })
        dismissBtn.focus()
        expect(document.activeElement).toBe(dismissBtn)
        fireEvent.click(dismissBtn)
        expect(screen.queryByRole('alert')).toBeNull()
        expect(screen.getByText('Rebalance history error dismissed.')).toBeTruthy()
    })

    it('blocks duplicate retries while a history refetch is in flight', async () => {
        let resolveRefetch!: (value: { isSuccess: boolean }) => void
        const refetch = vi.fn(() => new Promise<{ isSuccess: boolean }>(resolve => {
            resolveRefetch = resolve
        }))
        const mutateAsync = vi.fn()
        mocks.useExecuteRebalanceMutation.mockReturnValue({ mutateAsync, isPending: false })
        mocks.useHistoryMock.mockReturnValue({
            data: undefined,
            isLoading: false,
            error: new Error('history unavailable'),
            refetch,
            isFetching: false,
        })
        renderDashboard()
        const retryBtn = await screen.findByRole('button', { name: 'Retry loading rebalance history' })
        fireEvent.click(retryBtn)
        fireEvent.click(retryBtn)
        expect(refetch).toHaveBeenCalledTimes(1)
        expect(mutateAsync).not.toHaveBeenCalled()
        expect(screen.getByText('Portfolio Value')).toBeTruthy()
        resolveRefetch({ isSuccess: false })
    })
    it('allows another retry after a failed retry and keeps the error visible', async () => {
        const refetch = vi.fn().mockRejectedValueOnce(new Error('still down')).mockResolvedValue({ isSuccess: false })
        mocks.useHistoryMock.mockReturnValue({
            data: undefined,
            isLoading: false,
            error: new Error('history unavailable'),
            refetch,
            isFetching: false,
        })
        renderDashboard()
        const retryBtn = await screen.findByRole('button', { name: 'Retry loading rebalance history' })
        fireEvent.click(retryBtn)
        await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
        expect(screen.getByRole('alert').textContent).toContain('Failed to load rebalance history')
        await waitFor(() => {
            fireEvent.click(screen.getByRole('button', { name: 'Retry loading rebalance history' }))
            expect(refetch).toHaveBeenCalledTimes(2)
        })
        expect(screen.getByRole('alert')).toBeTruthy()
    })

    it('keeps the current page after a failed history load is retried', async () => {
        const events = Array.from({ length: 10 }, (_, index) => ({
            id: `e-${index}`,
            timestamp: TIMESTAMP,
            trigger: 'Scheduled rebalance',
            trades: 1,
            gasUsed: '0.01 XLM',
            status: 'completed',
            portfolioId: 'p-1',
        }))
        const refetch = vi.fn().mockResolvedValue({ isSuccess: true })
        const ok = { data: { history: events, total: 25 }, isLoading: false, isFetching: false, error: null, refetch }
        const failed = { data: undefined, isLoading: false, isFetching: false, error: new Error('history unavailable'), refetch }
        mocks.useHistoryMock.mockReturnValue(ok)
        const { rerender } = render(<RebalanceHistory portfolioId="p-1" />)
        fireEvent.click(await screen.findByRole('button', { name: '2' }))
        expect(mocks.useHistoryMock).toHaveBeenLastCalledWith('p-1', 2, 10, '', '', '', '')
        mocks.useHistoryMock.mockReturnValue(failed)
        rerender(<RebalanceHistory portfolioId="p-1" />)
        fireEvent.click(await screen.findByRole('button', { name: 'Retry loading rebalance history' }))
        await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
        mocks.useHistoryMock.mockReturnValue(ok)
        rerender(<RebalanceHistory portfolioId="p-1" />)
        expect(screen.queryByRole('alert')).toBeNull()
        expect(mocks.useHistoryMock).toHaveBeenLastCalledWith('p-1', 2, 10, '', '', '', '')
    })

    it('exposes accessible pagination names, current page state, and page-change announcements', async () => {
        mocks.useHistoryMock.mockReturnValue({
            data: {
                history: Array.from({ length: 10 }, (_, index) => ({
                    id: `e-${index}`,
                    timestamp: TIMESTAMP,
                    trigger: 'Scheduled rebalance',
                    trades: 1,
                    gasUsed: '0.01 XLM',
                    status: 'completed',
                    portfolioId: 'p-1',
                })),
                total: 25,
            },
            isLoading: false,
            error: null,
        })

        render(<RebalanceHistory portfolioId="p-1" />)

        expect(await screen.findByRole('navigation', { name: 'Rebalance history pagination' })).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Next page' })).not.toBeDisabled()
        expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page')

        fireEvent.click(screen.getByRole('button', { name: '2' }))
        expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'page')
        expect(screen.getByText('Showing rebalance history page 2 of 3.')).toBeTruthy()
    })
})
