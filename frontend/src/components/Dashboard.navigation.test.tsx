/**
 * SPR-2026-090: Mobile portfolio navigation component tests.
 *
 * Verifies that portfolio navigation and header action buttons remain
 * reachable and visible at 320px width with 200% text sizing, stay
 * consistent when a header menu is open across wallet state changes,
 * support error recovery, and prevent duplicate submissions using
 * isolated wallet and API doubles.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from './Dashboard'
import Landing from './Landing'

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
    apiPost: vi.fn(async () => ({ hash: 'share-hash', active: true })),
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

vi.mock('./ThemeToggle', () => ({ default: () => <button type="button">Theme Toggle</button> }))
vi.mock('./WalletSelector', () => ({ WalletSelector: () => <div>Wallet selector</div> }))
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
vi.mock('./ExportPDF', () => ({ default: () => <button type="button">Export Report</button> }))

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
        api: {
            get: testDoubles.apiGet,
            post: testDoubles.apiPost,
            delete: testDoubles.apiDelete,
        },
        downloadPortfolioExport: vi.fn(async () => undefined),
    }
})

function renderWithQueryClient(ui: React.ReactElement) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return render(ui, {
        wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    })
}

/**
 * The same label can exist in the header, the section tabs and the sticky mobile
 * action bar (jsdom ignores `md:hidden`), so pick the header's control.
 */
function getHeaderButton(name: RegExp): HTMLElement {
    const match = screen
        .getAllByRole('button', { name })
        .find((button) => !button.closest('.mobile-action-bar') && !button.closest('nav[aria-label="Dashboard sections"]'))
    if (!match) throw new Error(`No header button matching ${name}`)
    return match
}

const CONNECTED_KEY = 'GABCD1234567890TESTKEY1234567890'
const SECOND_KEY = 'GZYXW9876543210TESTKEY9876543210'

const samplePortfolio = {
    id: 'portfolio-mobile-1',
    userAddress: CONNECTED_KEY,
    allocations: { XLM: 60, USDC: 40 },
    threshold: 5,
    totalValue: 5000,
    balances: { XLM: 20000, USDC: 2000 },
    lastRebalance: '2026-01-15T00:00:00.000Z',
    needsRebalance: false,
}

describe('Mobile portfolio navigation (SPR-2026-090)', () => {
    const originalInnerWidth = window.innerWidth

    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()

        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            writable: true,
            value: 320,
        })
        document.documentElement.style.fontSize = '200%'

        testDoubles.useUserPortfolios.mockReturnValue({
            data: [samplePortfolio],
            isLoading: false,
            isError: false,
            error: null,
            refetch: vi.fn(async () => ({ data: [samplePortfolio] })),
        })
        testDoubles.usePortfolioDetails.mockReturnValue({
            data: samplePortfolio,
            isLoading: false,
            isError: false,
            error: null,
            refetch: vi.fn(async () => ({ data: samplePortfolio })),
        })
        testDoubles.useRebalanceEstimate.mockReturnValue({ data: null })
        testDoubles.useRebalancePlan.mockReturnValue({ data: null, isLoading: false, isError: false })
        testDoubles.usePrices.mockReturnValue({
            data: { XLM: { price: 0.15 }, USDC: { price: 1 } },
            isLoading: false,
            isError: false,
            error: null,
            refetch: vi.fn(async () => ({ data: { XLM: { price: 0.15 }, USDC: { price: 1 } } })),
        })
        testDoubles.useExecuteRebalanceMutation.mockReturnValue({
            mutateAsync: vi.fn(),
            isPending: false,
        })
        testDoubles.invalidateQueries.mockResolvedValue(undefined)
        testDoubles.apiDelete.mockResolvedValue(undefined)
        testDoubles.authLogout.mockResolvedValue(undefined)
    })

    afterEach(() => {
        document.documentElement.style.fontSize = ''
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            writable: true,
            value: originalInnerWidth,
        })
    })

    it('keeps navigation and header action buttons reachable and wrappable at 320px width and 200% text size', () => {
        const onNavigate = vi.fn()
        renderWithQueryClient(<Dashboard onNavigate={onNavigate} publicKey={CONNECTED_KEY} />)

        const heading = screen.getByRole('heading', { name: /portfolio dashboard/i })
        expect(heading).toBeVisible()
        expect(heading.className).toMatch(/\bbreak-words\b/)

        const headerFlex = heading.closest('.flex-wrap')
        expect(headerFlex).not.toBeNull()
        expect(headerFlex?.className).toMatch(/\bmin-w-0\b/)

        const navActions: Array<[RegExp, string]> = [
            [/go to landing/i, 'landing'],
            [/^analytics$/i, 'analytics'],
            [/^tax report$/i, 'tax-report'],
            [/^settings$/i, 'settings'],
            [/wizard/i, 'wizard'],
            [/create portfolio/i, 'setup'],
        ]

        for (const [label, expectedView] of navActions) {
            const button = getHeaderButton(label)
            expect(button).toBeVisible()
            expect(button).toBeEnabled()
            fireEvent.click(button)
            expect(onNavigate).toHaveBeenCalledWith(expectedView)
        }

        expect(getHeaderButton(/refresh data/i)).toBeVisible()
        expect(screen.getByRole('button', { name: /change language/i })).toBeVisible()
        expect(screen.getByRole('button', { name: /disconnect/i })).toBeVisible()
    })

    it('keeps navigation and open language menu consistent across wallet connect, switch, and disconnect', () => {
        const onNavigate = vi.fn()
        const view = renderWithQueryClient(<Dashboard onNavigate={onNavigate} publicKey={null} />)

        // Open the header language menu while in demo mode.
        const languageTrigger = screen.getByRole('button', { name: /change language/i })
        fireEvent.click(languageTrigger)
        expect(languageTrigger).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: /connect wallet/i })).toBeVisible()
        expect(getHeaderButton(/reset demo portfolio/i)).toBeVisible()

        // Connect a wallet while the menu is open.
        view.rerender(<Dashboard onNavigate={onNavigate} publicKey={CONNECTED_KEY} />)

        expect(screen.getByRole('button', { name: /change language/i })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.queryByRole('button', { name: /connect wallet/i })).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: /disconnect/i })).toBeVisible()
        expect(screen.getByRole('button', { name: /create portfolio/i })).toBeVisible()
        expect(screen.getByText(/GABC\.\.\.7890/)).toBeVisible()

        // Switch to a different wallet while the menu remains open.
        view.rerender(<Dashboard onNavigate={onNavigate} publicKey={SECOND_KEY} />)
        expect(screen.getByText(/GZYX\.\.\.3210/)).toBeVisible()

        // Close the open menu via Escape and verify navigation remains reachable.
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
        expect(screen.getByRole('button', { name: /change language/i })).toHaveAttribute('aria-expanded', 'false')

        fireEvent.click(getHeaderButton(/^analytics$/i))
        expect(onNavigate).toHaveBeenCalledWith('analytics')

        // Disconnect wallet and confirm demo navigation actions reappear.
        view.rerender(<Dashboard onNavigate={onNavigate} publicKey={null} />)
        expect(screen.getByRole('button', { name: /connect wallet/i })).toBeVisible()
        expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument()
    })

    it('updates an open Landing wallet dropdown menu cleanly when wallet state changes', () => {
        const onNavigate = vi.fn()
        const onConnectWallet = vi.fn().mockResolvedValue(undefined)
        const view = render(
            <Landing
                onNavigate={onNavigate}
                onConnectWallet={onConnectWallet}
                isConnecting={false}
                publicKey={CONNECTED_KEY}
            />,
        )

        const walletButton = screen.getByRole('button', { name: /GABC/i })
        fireEvent.click(walletButton)
        expect(screen.getByText(/connected as/i)).toBeVisible()
        expect(screen.getByRole('button', { name: /disconnect/i })).toBeVisible()

        // Wallet disconnects while dropdown is open.
        view.rerender(
            <Landing
                onNavigate={onNavigate}
                onConnectWallet={onConnectWallet}
                isConnecting={false}
                publicKey={null}
            />,
        )

        expect(screen.queryByText(/connected as/i)).not.toBeInTheDocument()
        const connectButtons = screen.getAllByRole('button', { name: /connect wallet/i })
        expect(connectButtons.length).toBeGreaterThan(0)
        expect(connectButtons[0]).toBeVisible()
    })

    it('recovers from portfolio load errors via the retry action at 320px and 200% text size', async () => {
        const onNavigate = vi.fn()
        const refetchPortfolios = vi.fn(async () => ({ data: [samplePortfolio] }))
        const refetchPrices = vi.fn(async () => ({ data: { XLM: { price: 0.15 }, USDC: { price: 1 } } }))

        testDoubles.useUserPortfolios.mockReturnValue({
            data: [],
            isLoading: false,
            isError: true,
            error: new Error('Temporary RPC outage'),
            refetch: refetchPortfolios,
        })
        testDoubles.usePortfolioDetails.mockReturnValue({
            data: null,
            isLoading: false,
            isError: false,
            error: null,
            refetch: vi.fn(async () => ({ data: samplePortfolio })),
        })
        testDoubles.usePrices.mockReturnValue({
            data: {},
            isLoading: false,
            isError: true,
            error: new Error('Price feed timeout'),
            refetch: refetchPrices,
        })

        const view = renderWithQueryClient(<Dashboard onNavigate={onNavigate} publicKey={CONNECTED_KEY} />)

        expect(await screen.findByRole('heading', { name: /portfolio data is unavailable/i })).toBeVisible()
        const retryButton = screen.getByRole('button', { name: /retry loading/i })
        const backButton = screen.getByRole('button', { name: /go to landing/i })
        expect(retryButton).toBeVisible()
        expect(backButton).toBeVisible()

        fireEvent.click(retryButton)
        // RouteErrorState delays the retry with a backoff (1s on the first attempt).
        await waitFor(() => expect(refetchPortfolios).toHaveBeenCalledTimes(1), { timeout: 3000 })
        expect(refetchPrices).toHaveBeenCalledTimes(1)

        // Simulate recovered data after retry.
        testDoubles.useUserPortfolios.mockReturnValue({
            data: [samplePortfolio],
            isLoading: false,
            isError: false,
            error: null,
            refetch: refetchPortfolios,
        })
        testDoubles.usePortfolioDetails.mockReturnValue({
            data: samplePortfolio,
            isLoading: false,
            isError: false,
            error: null,
            refetch: vi.fn(async () => ({ data: samplePortfolio })),
        })
        testDoubles.usePrices.mockReturnValue({
            data: { XLM: { price: 0.15 }, USDC: { price: 1 } },
            isLoading: false,
            isError: false,
            error: null,
            refetch: refetchPrices,
        })

        view.rerender(<Dashboard onNavigate={onNavigate} publicKey={CONNECTED_KEY} />)

        expect(screen.getByRole('heading', { name: /portfolio dashboard/i })).toBeVisible()
        expect(getHeaderButton(/^analytics$/i)).toBeVisible()
    })

    it('prevents duplicate submissions for demo reset and account data deletion while in flight', async () => {
        const onNavigate = vi.fn()

        // 1. Demo reset duplicate submission guard
        let resolveInvalidate!: () => void
        testDoubles.invalidateQueries.mockImplementationOnce(
            () => new Promise<void>(resolve => {
                resolveInvalidate = resolve
            }),
        )

        const view = renderWithQueryClient(<Dashboard onNavigate={onNavigate} publicKey={null} />)

        fireEvent.click(getHeaderButton(/reset demo portfolio/i))
        const confirmReset = screen.getByRole('button', { name: /^reset demo$/i })
        fireEvent.click(confirmReset)
        fireEvent.click(confirmReset)

        expect(testDoubles.invalidateQueries).toHaveBeenCalledTimes(1)
        resolveInvalidate()

        await waitFor(() => {
            expect(testDoubles.invalidateQueries).toHaveBeenCalledTimes(2)
        })

        // 2. Delete my data duplicate submission guard
        let resolveDelete!: () => void
        testDoubles.apiDelete.mockImplementationOnce(
            () => new Promise<void>(resolve => {
                resolveDelete = resolve
            }),
        )

        view.rerender(<Dashboard onNavigate={onNavigate} publicKey={CONNECTED_KEY} />)

        fireEvent.click(screen.getByRole('button', { name: /delete my data/i }))
        const confirmDelete = screen.getByRole('button', { name: /delete all my data/i })
        fireEvent.click(confirmDelete)
        fireEvent.click(confirmDelete)

        expect(testDoubles.apiDelete).toHaveBeenCalledTimes(1)
        resolveDelete()

        await waitFor(() => {
            expect(testDoubles.authLogout).toHaveBeenCalledWith(CONNECTED_KEY)
            expect(testDoubles.walletDisconnect).toHaveBeenCalledTimes(1)
            expect(onNavigate).toHaveBeenCalledWith('landing')
        })
    })

    describe('narrow-width layout (SPR-2026-089)', () => {
        it('wraps the section tabs instead of overflowing, and marks the active tab', () => {
            renderWithQueryClient(<Dashboard onNavigate={vi.fn()} publicKey={CONNECTED_KEY} />)

            const nav = screen.getByRole('navigation', { name: /dashboard sections/i })
            // Three tabs with fixed 32px gaps are wider than 320px; they must wrap.
            expect(nav.className).toMatch(/\bflex-wrap\b/)
            expect(nav.className).not.toMatch(/\bspace-x-8\b/)

            const tabs = within(nav).getAllByRole('button')
            expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'Analytics', 'Notifications'])
            for (const tab of tabs) {
                expect(tab).toBeVisible()
                expect(tab.className).toMatch(/\bmin-h-\[44px\]\b/)
            }

            expect(tabs[0]).toHaveAttribute('aria-current', 'page')
            expect(tabs[1]).not.toHaveAttribute('aria-current')
            fireEvent.click(tabs[1])
            expect(tabs[1]).toHaveAttribute('aria-current', 'page')
            expect(tabs[0]).not.toHaveAttribute('aria-current')
        })

        it('uses responsive page padding so 320px keeps its content width', () => {
            renderWithQueryClient(<Dashboard onNavigate={vi.fn()} publicKey={CONNECTED_KEY} />)

            const nav = screen.getByRole('navigation', { name: /dashboard sections/i })
            const page = nav.closest('.max-w-7xl')
            expect(page).not.toBeNull()
            expect(page?.className).toMatch(/\bp-4\b/)
            expect(page?.className).toMatch(/\bsm:p-6\b/)
            expect(page?.className).not.toMatch(/(^|\s)p-6(\s|$)/)
            expect(page?.className).toMatch(/\bmin-w-0\b/)
        })

        it('keeps the mobile action bar in flow so enlarged text never hides content behind it', () => {
            const { container } = renderWithQueryClient(
                <Dashboard onNavigate={vi.fn()} publicKey={CONNECTED_KEY} />,
            )

            const bar = container.querySelector('.mobile-action-bar')
            expect(bar).not.toBeNull()
            // A fixed bar plus a fixed-height spacer covers content once the bar grows past the spacer.
            expect(bar?.className).toMatch(/\bsticky\b/)
            expect(bar?.className).not.toMatch(/\bfixed\b/)
            expect(container.querySelector('.h-20')).toBeNull()

            expect(bar?.querySelector('.flex-wrap')).not.toBeNull()
            const buttons = within(bar as HTMLElement).getAllByRole('button')
            expect(buttons.length).toBeGreaterThan(0)
            for (const button of buttons) {
                expect(button).toBeVisible()
                expect(button.className).toMatch(/\bmin-h-\[44px\]\b/)
            }
        })
    })
})
