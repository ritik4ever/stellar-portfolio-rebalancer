import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Dashboard from './Dashboard'

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

function renderDashboard(ui: React.ReactElement) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const wrap = (node: React.ReactElement) => <QueryClientProvider client={client}>{node}</QueryClientProvider>
    const view = render(wrap(ui))
    return { ...view, rerender: (next: React.ReactElement) => view.rerender(wrap(next)) }
}

const bar = () => within(screen.getByRole('region', { name: 'Portfolio quick actions' }))
const sectionNav = () => within(screen.getByRole('navigation', { name: 'Dashboard sections' }))

/** Pin the rendered height of the fixed bar (jsdom has no layout). */
function mockBarHeight(height: number) {
    return vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('mobile-action-bar') ? height : 0
    })
}

describe('Dashboard mobile portfolio navigation (SPR-2026-088)', () => {
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

    describe('section navigation', () => {
        it('exposes the current section and moves it with the selection', async () => {
            const user = userEvent.setup()
            renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

            const nav = sectionNav()
            expect(nav.getByRole('button', { name: 'Overview section' })).toHaveAttribute('aria-current', 'true')
            expect(nav.getByRole('button', { name: 'Analytics section' })).not.toHaveAttribute('aria-current')

            await user.click(nav.getByRole('button', { name: 'Analytics section' }))
            expect(nav.getByRole('button', { name: 'Analytics section' })).toHaveAttribute('aria-current', 'true')
            expect(nav.getByRole('button', { name: 'Overview section' })).not.toHaveAttribute('aria-current')
        })

        it('is operable from the keyboard and announces the section that was shown', async () => {
            const user = userEvent.setup()
            renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

            sectionNav().getByRole('button', { name: 'Analytics section' }).focus()
            await user.keyboard('{Enter}')
            expect(await screen.findByText('Performance Chart')).toBeInTheDocument()
            expect(screen.getByText('Analytics section shown')).toBeInTheDocument()
            // Activating a tab must not move focus away from it.
            expect(sectionNav().getByRole('button', { name: 'Analytics section' })).toHaveFocus()

            await user.keyboard('{Tab}{Enter}')
            expect(await screen.findByText('Notification Preferences')).toBeInTheDocument()
            expect(screen.getByText('Notifications section shown')).toBeInTheDocument()
        })

        it('wraps instead of overflowing, so 320px and enlarged text stay reachable', () => {
            renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            const nav = screen.getByRole('navigation', { name: 'Dashboard sections' })
            expect(nav).toHaveClass('flex-wrap')
            for (const button of within(nav).getAllByRole('button')) {
                expect(button).toHaveClass('min-h-[44px]')
            }
        })

        it('qualifies the in-page Analytics section so it differs from the header Analytics link', async () => {
            const user = userEvent.setup()
            const onNavigate = vi.fn()
            renderDashboard(<Dashboard onNavigate={onNavigate} publicKey="GABC1234TEST" />)

            // Exactly one control is named "Analytics" (the link to the full page) ...
            await user.click(screen.getByRole('button', { name: /^Analytics$/ }))
            expect(onNavigate).toHaveBeenCalledWith('analytics')
            // ... and the section control is announced as a section.
            expect(sectionNav().getByRole('button', { name: 'Analytics section' })).toBeInTheDocument()
        })

        it('explains the Notifications section instead of rendering it blank without a wallet', async () => {
            const user = userEvent.setup()
            const view = renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

            await user.click(sectionNav().getByRole('button', { name: 'Notifications section' }))
            expect(screen.getByText('Notification Preferences')).toBeInTheDocument()

            // Wallet state changes while that section is open.
            view.rerender(<Dashboard onNavigate={vi.fn()} publicKey={null} />)
            expect(screen.queryByText('Notification Preferences')).not.toBeInTheDocument()
            expect(screen.getByText('Connect a wallet to manage notification preferences.')).toBeInTheDocument()
            expect(sectionNav().getByRole('button', { name: 'Notifications section' })).toHaveAttribute('aria-current', 'true')
        })
    })

    describe('mobile action bar', () => {
        it('is a named region', () => {
            renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            expect(screen.getByRole('region', { name: 'Portfolio quick actions' })).toBeInTheDocument()
        })

        it('keeps a name on the icon-only "new portfolio" button at phone widths', async () => {
            const user = userEvent.setup()
            const onNavigate = vi.fn()
            renderDashboard(<Dashboard onNavigate={onNavigate} publicKey="GABC1234TEST" />)

            // The visible "New" label is hidden below the sm breakpoint; the name must not be.
            const button = bar().getByRole('button', { name: 'New portfolio' })
            await user.click(button)
            expect(onNavigate).toHaveBeenCalledWith('setup')
        })

        it('keeps the "Balanced" status readable by screen readers when its text is visually hidden', () => {
            renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            const balanced = bar().getByText('Balanced')
            expect(balanced).toHaveClass('sr-only')
            expect(balanced).not.toHaveClass('hidden')
        })

        it('states the direction of the day change in text, not only colour and icon direction', () => {
            queryMocks.useUserPortfolios.mockReturnValue({
                data: [{ id: 'p-1', totalValue: 5000, dayChange: -2.5, allocations: [{ asset: 'XLM', target: 100, amount: 5000 }] }],
                isLoading: false,
                isError: false,
            })
            renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            expect(bar().getByText('Down today:')).toBeInTheDocument()
            expect(bar().getByText('2.50%')).toBeInTheDocument()
        })

        it('returns keyboard focus to Refresh after the loading screen replaces the dashboard', async () => {
            const user = userEvent.setup()
            const view = renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

            const refresh = bar().getByRole('button', { name: 'Refresh portfolio data' })
            refresh.focus()
            await user.keyboard('{Enter}')
            expect(queryMocks.invalidateQueries).toHaveBeenCalled()

            // The dashboard is replaced by the loading screen, dropping focus to <body> ...
            queryMocks.useUserPortfolios.mockReturnValue({ data: [], isLoading: true, isError: false })
            view.rerender(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            expect(screen.getByRole('status')).toHaveTextContent('Loading portfolio data')
            expect(document.activeElement).toBe(document.body)

            // ... and comes back on a Refresh control when the data has loaded.
            queryMocks.useUserPortfolios.mockReturnValue({ data: [], isLoading: false, isError: false })
            view.rerender(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            expect(document.activeElement).not.toBe(document.body)
            expect(document.activeElement).toHaveAccessibleName('Refresh portfolio data')
        })

        it('does not steal focus after a refresh if the user already moved it elsewhere', async () => {
            const user = userEvent.setup()
            const view = renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            await user.click(bar().getByRole('button', { name: 'Refresh portfolio data' }))

            queryMocks.useUserPortfolios.mockReturnValue({ data: [], isLoading: true, isError: false })
            view.rerender(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            const target = document.createElement('button')
            document.body.appendChild(target)
            target.focus()

            queryMocks.useUserPortfolios.mockReturnValue({ data: [], isLoading: false, isError: false })
            view.rerender(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            expect(target).toHaveFocus()
            target.remove()
        })

        it('reserves room for the bar at larger text sizes and for focus scrolling', () => {
            mockBarHeight(220)
            const view = renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

            const spacer = view.container.querySelector('div.md\\:hidden[aria-hidden="true"]') as HTMLElement
            expect(spacer).toBeTruthy()
            expect(spacer.style.height).toBe('220px')
            expect(document.documentElement.style.scrollPaddingBottom).toBe('220px')

            view.unmount()
            expect(document.documentElement.style.scrollPaddingBottom).toBe('')
        })

        it('never shrinks the spacer below the original 80px', () => {
            mockBarHeight(40)
            const view = renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            const spacer = view.container.querySelector('div.md\\:hidden[aria-hidden="true"]') as HTMLElement
            expect(spacer.style.height).toBe('80px')
        })
    })

    describe('demo reset dialog', () => {
        async function openDialog(user: ReturnType<typeof userEvent.setup>) {
            const opener = bar().getByRole('button', { name: 'Reset demo data' })
            await user.click(opener)
            return opener
        }

        it('is a modal dialog with a name and description, focused on its primary action', async () => {
            const user = userEvent.setup()
            renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)
            await openDialog(user)

            const dialog = screen.getByRole('dialog', { name: 'Reset Demo Portfolio' })
            expect(dialog).toHaveAttribute('aria-modal', 'true')
            expect(dialog).toHaveAccessibleDescription(/reset the demo portfolio to its default state/i)
            expect(within(dialog).getByRole('button', { name: 'Reset Demo' })).toHaveFocus()
        })

        it('announces that the opener opens a dialog', () => {
            renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)
            expect(bar().getByRole('button', { name: 'Reset demo data' })).toHaveAttribute('aria-haspopup', 'dialog')
        })

        it('keeps Tab and Shift+Tab inside the dialog', async () => {
            const user = userEvent.setup()
            renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)
            await openDialog(user)
            const dialog = within(screen.getByRole('dialog'))
            const cancel = dialog.getByRole('button', { name: 'Cancel' })
            const confirm = dialog.getByRole('button', { name: 'Reset Demo' })

            expect(confirm).toHaveFocus()
            await user.tab()
            expect(cancel).toHaveFocus() // wrapped from last to first
            await user.tab({ shift: true })
            expect(confirm).toHaveFocus() // wrapped from first to last
        })

        it('closes on Escape and returns focus to the control that opened it', async () => {
            const user = userEvent.setup()
            renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)
            const opener = await openDialog(user)

            await user.keyboard('{Escape}')
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
            expect(opener).toHaveFocus()
        })

        it('closes via Cancel and returns focus to the opener', async () => {
            const user = userEvent.setup()
            renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)
            const opener = await openDialog(user)

            await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
            expect(opener).toHaveFocus()
        })

        it('keeps focus inside the dialog and announces progress while the reset runs', async () => {
            const user = userEvent.setup()
            let resolve!: () => void
            queryMocks.invalidateQueries.mockImplementation(() => new Promise<undefined>(r => { resolve = () => r(undefined) }))
            renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)
            await openDialog(user)

            const dialog = screen.getByRole('dialog')
            const confirm = within(dialog).getByRole('button', { name: 'Reset Demo' })
            await user.click(confirm)

            expect(dialog).toHaveAttribute('aria-busy', 'true')
            expect(within(dialog).getByText('Resetting demo portfolio')).toBeInTheDocument()
            expect(confirm).toHaveAttribute('aria-disabled', 'true')
            expect(confirm).toHaveFocus() // not dropped to <body> by `disabled`

            // Escape and Cancel are ignored mid-reset.
            await user.keyboard('{Escape}')
            expect(screen.getByRole('dialog')).toBeInTheDocument()

            await act(async () => { resolve(); resolve = () => undefined })
            await act(async () => { resolve() })
        })

        it('closes the dialog and explains why when a wallet connects while it is open', async () => {
            const user = userEvent.setup()
            const view = renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)
            await openDialog(user)
            expect(screen.getByRole('dialog')).toBeInTheDocument()

            view.rerender(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)

            expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
            expect(screen.getByText('Wallet connected. Portfolio actions updated.')).toBeInTheDocument()
            // Focus stays in the action bar (on the control that replaced Reset), not on <body>.
            expect(document.activeElement).not.toBe(document.body)
            expect(screen.getByRole('region', { name: 'Portfolio quick actions' })).toContainElement(document.activeElement as HTMLElement)
            expect(bar().getByRole('button', { name: 'New portfolio' })).toBeInTheDocument()
            expect(bar().queryByRole('button', { name: 'Reset demo data' })).not.toBeInTheDocument()
        })

        it('does not leave a stale failure message when a wallet connects mid-error', async () => {
            const user = userEvent.setup()
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
            queryMocks.invalidateQueries.mockRejectedValueOnce(new Error('Network unavailable'))
            const view = renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)
            await openDialog(user)
            await user.click(screen.getByRole('button', { name: 'Reset Demo' }))
            expect(await screen.findByRole('alert')).toHaveTextContent(/Network unavailable/)

            view.rerender(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
            expect(screen.queryByRole('alert')).not.toBeInTheDocument()
            consoleError.mockRestore()
        })
    })

    describe('open language menu', () => {
        it('stays open, keeps keyboard focus and stays dismissible while the wallet connects and disconnects', async () => {
            const user = userEvent.setup()
            const view = renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)

            const trigger = screen.getByRole('button', { name: 'Change language' })
            trigger.focus()
            await user.keyboard('{Enter}')
            expect(trigger).toHaveAttribute('aria-expanded', 'true')
            const focused = document.activeElement as HTMLElement
            expect(focused).toHaveAttribute('role', 'menuitem')

            view.rerender(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            expect(screen.getByRole('button', { name: 'Change language' })).toHaveAttribute('aria-expanded', 'true')
            expect(focused).toHaveFocus()

            view.rerender(<Dashboard onNavigate={vi.fn()} publicKey={null} />)
            expect(focused).toHaveFocus()

            await user.keyboard('{Escape}')
            expect(screen.getByRole('button', { name: 'Change language' })).toHaveAttribute('aria-expanded', 'false')
            expect(screen.getByRole('button', { name: 'Change language' })).toHaveFocus()
        })
    })

    describe('wallet state changes', () => {
        it('announces a connect and a disconnect, and not the initial state', () => {
            const view = renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)
            expect(screen.queryByText(/Wallet (connected|disconnected)/)).not.toBeInTheDocument()

            view.rerender(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            expect(screen.getByText('Wallet connected. Portfolio actions updated.')).toBeInTheDocument()

            view.rerender(<Dashboard onNavigate={vi.fn()} publicKey={null} />)
            expect(screen.getByText('Wallet disconnected. Showing the demo portfolio.')).toBeInTheDocument()
        })

        it('keeps keyboard focus on the action-bar control that changes meaning', async () => {
            const user = userEvent.setup()
            const view = renderDashboard(<Dashboard onNavigate={vi.fn()} publicKey={null} />)
            const reset = bar().getByRole('button', { name: 'Reset demo data' })
            await user.tab() // ensure keyboard modality
            reset.focus()
            expect(reset).toHaveFocus()

            view.rerender(<Dashboard onNavigate={vi.fn()} publicKey="GABC1234TEST" />)
            expect(bar().getByRole('button', { name: 'New portfolio' })).toHaveFocus()
        })
    })
})
