/**
 * SPR-2026-055: Rebalance history edge and failure states.
 *
 * The history section is rendered inside Dashboard with isolated wallet/API
 * doubles so a failing history query is proven to stay independent of the
 * dashboard. Events that share a timestamp must keep their API order and
 * trade amounts, and recovering from a failed page must not duplicate
 * entries or submit any rebalance work.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from './Dashboard'

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
    portfolioKeys: { all: ['portfolios'] },
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

const historyEvents = [
    {
        id: 'e-first',
        timestamp: TIMESTAMP,
        trigger: 'Automatic Rebalancing',
        trades: 2,
        gasUsed: '0.02 XLM',
        status: 'completed',
        portfolioId: 'p-1',
        details: { amount: 1200, fromAsset: 'XLM', toAsset: 'USDC' },
    },
    {
        id: 'e-second',
        timestamp: TIMESTAMP,
        trigger: 'Manual Rebalance',
        trades: 3,
        gasUsed: '0.03 XLM',
        status: 'completed',
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

describe('RebalanceHistory edge states (SPR-2026-055)', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockPopulatedPortfolio()
        const mutateAsync = vi.fn().mockResolvedValue({ result: { gasUsed: '0 XLM' } })
        mocks.useExecuteRebalanceMutation.mockReturnValue({ mutateAsync, isPending: false })
    })

    it('keeps stable event order and trade amounts for two events sharing a timestamp', async () => {
        mocks.useHistoryMock.mockReturnValue({
            data: { history: historyEvents, total: 2 },
            isLoading: false,
            error: null,
        })

        renderDashboard()

        const first = await screen.findByText('Automatic Rebalancing')
        const second = await screen.findByText('Manual Rebalance')
        expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(screen.getByText('2 trades')).toBeTruthy()
        expect(screen.getByText('3 trades')).toBeTruthy()
        expect(screen.getByText(/Amount: \$1,200/)).toBeTruthy()
        expect(screen.getByText(/Amount: \$800/)).toBeTruthy()
        // Each event renders exactly once — no duplicated submission of rows.
        expect(screen.getAllByText('Automatic Rebalancing')).toHaveLength(1)
        expect(screen.getAllByText('Manual Rebalance')).toHaveLength(1)
    })

    it('fails independently of the dashboard and recovers without duplicating events or submitting work', async () => {
        const mutateAsync = vi.fn()
        mocks.useExecuteRebalanceMutation.mockReturnValue({ mutateAsync, isPending: false })
        mocks.useHistoryMock.mockReturnValue({
            data: undefined,
            isLoading: false,
            error: new Error('history unavailable'),
        })

        const { rerender } = renderDashboard()

        // The history section reports its own failure while the dashboard stays usable.
        expect(await screen.findByText(/Failed to load rebalance history/i)).toBeTruthy()
        expect(screen.getByText('Portfolio Value')).toBeTruthy()
        expect(screen.getByText('Asset Card XLM')).toBeTruthy()
        expect(mutateAsync).not.toHaveBeenCalled()

        // Recovery: the same query now returns data; events render exactly once.
        mocks.useHistoryMock.mockReturnValue({
            data: { history: historyEvents, total: 2 },
            isLoading: false,
            error: null,
        })
        rerender(
            <QueryClientProvider client={new QueryClient()}>
                <Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />
            </QueryClientProvider>,
        )

        expect(await screen.findByText('Automatic Rebalancing')).toBeTruthy()
        expect(screen.getAllByText('Automatic Rebalancing')).toHaveLength(1)
        expect(screen.getAllByText('Manual Rebalance')).toHaveLength(1)
        expect(screen.queryByText(/Failed to load rebalance history/i)).toBeNull()
        expect(mutateAsync).not.toHaveBeenCalled()
    })
})
