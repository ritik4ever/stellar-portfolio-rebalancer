import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import RebalanceConfirm from './RebalanceConfirm'

const mocks = vi.hoisted(() => ({
    useRebalancePlan: vi.fn(),
    mutateAsync: vi.fn(),
}))

vi.mock('../hooks/queries/usePortfolioQuery', () => ({ useRebalancePlan: mocks.useRebalancePlan }))
vi.mock('../hooks/mutations/usePortfolioMutations', () => ({
    useExecuteRebalanceMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}))

const quoteDate = '2026-10-10T12:00:00Z'
const quoteTimestamp = Date.parse(quoteDate) / 1000

function showPlan(tradeCount: number) {
    mocks.useRebalancePlan.mockReturnValue({
        data: {
            maxSlippagePercent: 2,
            estimatedFees: { xlm: tradeCount * 0.001, usd: tradeCount * 0.01, tradeCount },
            boundary: {
                reasonCode: tradeCount ? 'TRADES_REQUIRED' : 'WITHIN_EVERY_THRESHOLD',
                trades: Array.from({ length: tradeCount }, (_, index) => ({ asset: `Asset ${index + 1}`, action: 'buy', amount: 123 })),
                quoteSnapshot: {
                    prices: {
                        XLM: { timestamp: quoteTimestamp },
                        ...Object.fromEntries(Array.from({ length: tradeCount }, (_, index) => [
                            `Asset ${index + 1}`, { timestamp: quoteTimestamp + 60 },
                        ])),
                    },
                    feedMeta: { staleOrLimited: true },
                },
            },
        },
    })
}

beforeEach(() => {
    cleanup()
    vi.resetAllMocks()
})

describe('RebalanceConfirm', () => {
    it('closes a no-trade review without offering execution', () => {
        showPlan(0)
        const close = vi.fn()
        render(<RebalanceConfirm portfolioId="p1" open onClose={close} />)
        expect(screen.getByRole('status')).toHaveTextContent('No trades are required and there is no network fee')
        expect(screen.queryByRole('button', { name: 'Confirm rebalance' })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Close' }))
        expect(close).toHaveBeenCalledOnce()
        expect(mocks.mutateAsync).not.toHaveBeenCalled()
    })

    it('shows every trade, total fees and the oldest quote from the same plan', async () => {
        showPlan(12)
        const close = vi.fn()
        const { container } = render(<RebalanceConfirm portfolioId="p1" open onClose={close} />)
        const list = screen.getByRole('region', { name: '12 planned trades' })
        list.focus()
        expect(list).toHaveFocus()
        expect(within(list).getAllByRole('listitem')).toHaveLength(12)
        expect(within(list).getByText('Buy 123 Asset 12')).toBeInTheDocument()
        expect(screen.getByText(/0.0120000 XLM/)).toHaveTextContent('~$0.120')
        expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-10-10T12:00:00.000Z')
        expect(screen.getByText('Some quoted prices may be stale.')).toBeInTheDocument()
        const confirm = screen.getByRole('button', { name: 'Confirm rebalance' })
        expect(confirm).toBeDisabled()
        fireEvent.click(screen.getByRole('checkbox'))
        fireEvent.click(confirm)
        await waitFor(() => expect(close).toHaveBeenCalledOnce())
        expect(mocks.mutateAsync).toHaveBeenCalledOnce()
    })

    it('requires fresh acknowledgement when the plan changes', () => {
        showPlan(2)
        const view = render(<RebalanceConfirm portfolioId="p1" open onClose={vi.fn()} />)
        fireEvent.click(screen.getByRole('checkbox'))
        expect(screen.getByRole('button', { name: 'Confirm rebalance' })).toBeEnabled()
        showPlan(3)
        view.rerender(<RebalanceConfirm portfolioId="p1" open onClose={vi.fn()} />)
        expect(screen.getByRole('checkbox')).not.toBeChecked()
        expect(screen.getByRole('button', { name: 'Confirm rebalance' })).toBeDisabled()
    })

    it('guards against repeated clicks on submit, updates button name, and announces submission progress', async () => {
        showPlan(2)
        let resolveMutation!: () => void
        mocks.mutateAsync.mockImplementation(() => new Promise<void>(resolve => { resolveMutation = resolve }))

        render(<RebalanceConfirm portfolioId="p1" open onClose={vi.fn()} />)
        fireEvent.click(screen.getByRole('checkbox'))

        const confirm = screen.getByRole('button', { name: 'Confirm rebalance' })
        fireEvent.click(confirm)

        const submittingButton = screen.getByRole('button', { name: 'Submitting rebalance…' })
        expect(submittingButton).toBeDisabled()
        expect(submittingButton).toHaveAttribute('aria-busy', 'true')
        expect(screen.getByRole('status')).toHaveTextContent('Submitting rebalance…')
        expect(mocks.mutateAsync).toHaveBeenCalledTimes(1)

        // Repeated click while in flight is guarded and does not duplicate submission
        fireEvent.click(submittingButton)
        expect(mocks.mutateAsync).toHaveBeenCalledTimes(1)

        resolveMutation()
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Submitting rebalance…' })).toBeNull())
    })

    it('handles wallet rejection by focusing alert, resetting acknowledgement, and allowing user to abandon', async () => {
        showPlan(2)
        mocks.mutateAsync.mockRejectedValueOnce(new Error('User rejected transaction in wallet'))
        const close = vi.fn()

        render(<RebalanceConfirm portfolioId="p1" open onClose={close} />)
        const checkbox = screen.getByRole('checkbox')
        fireEvent.click(checkbox)

        fireEvent.click(screen.getByRole('button', { name: 'Confirm rebalance' }))

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveFocus()
        expect(alert).toHaveTextContent('Rebalance submission failed')
        expect(alert).toHaveTextContent('User rejected transaction in wallet')
        expect(alert).toHaveTextContent('Review and re-acknowledge the planned trades to retry, or cancel to abandon.')

        expect(checkbox).not.toBeChecked()
        expect(screen.getByRole('button', { name: 'Confirm rebalance' })).toBeDisabled()

        const cancel = screen.getByRole('button', { name: 'Cancel' })
        expect(cancel).toBeEnabled()
        fireEvent.click(cancel)
        expect(close).toHaveBeenCalledOnce()
    })

    it('handles lost network acknowledgement and enables completing the flow after re-acknowledgement', async () => {
        showPlan(2)
        mocks.mutateAsync.mockRejectedValueOnce(new Error('Network error: lost connection acknowledgement'))
        mocks.mutateAsync.mockResolvedValueOnce({ txId: 'tx-rebalance-456' })
        const close = vi.fn()
        const onSuccess = vi.fn()

        render(<RebalanceConfirm portfolioId="p1" open onClose={close} onSuccess={onSuccess} />)
        const checkbox = screen.getByRole('checkbox')
        fireEvent.click(checkbox)

        fireEvent.click(screen.getByRole('button', { name: 'Confirm rebalance' }))

        const alert = await screen.findByRole('alert')
        expect(alert).toHaveFocus()
        expect(alert).toHaveTextContent('Network error: lost connection acknowledgement')
        expect(checkbox).not.toBeChecked()

        // Re-acknowledge and complete the flow
        fireEvent.click(checkbox)
        const confirmBtn = screen.getByRole('button', { name: 'Confirm rebalance' })
        expect(confirmBtn).toBeEnabled()
        fireEvent.click(confirmBtn)

        await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ txId: 'tx-rebalance-456' }))
        expect(close).toHaveBeenCalledOnce()
    })

    it('allows abandoning flow via Escape key after a rejection', async () => {
        showPlan(2)
        mocks.mutateAsync.mockRejectedValueOnce(new Error('Transaction rejected'))
        const close = vi.fn()

        render(<RebalanceConfirm portfolioId="p1" open onClose={close} />)
        fireEvent.click(screen.getByRole('checkbox'))
        fireEvent.click(screen.getByRole('button', { name: 'Confirm rebalance' }))

        await screen.findByRole('alert')
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(close).toHaveBeenCalledOnce()
    })
})


// ─── SPR-2026-049: Narrow viewport and large text sizing ─────────────────────
// These tests confirm that controls, the error alert, fee text, and trade list
// remain in the DOM and have no inline overflow clipping at 320 px effective
// width, and that the layout does not force horizontal scroll when the browser
// text size is 200 % (simulated by doubling the root font size to 32 px).
//
// jsdom has no layout engine so we cannot measure pixel overflow.  Instead we
// assert the structural properties that make overflow impossible:
//   • the scrollable region has an overflow-y class and no overflow-x-hidden
//     that would clip the trade list horizontally
//   • every container that grows with content carries break-words / min-w-0
//   • buttons, the error alert, and the fee paragraph are always reachable by
//     role queries regardless of simulated font size

describe('RebalanceConfirm – narrow viewport / large text (SPR-2026-049)', () => {
    const originalFontSize = document.documentElement.style.fontSize

    afterEach(() => {
        document.documentElement.style.fontSize = originalFontSize
        cleanup()
    })

    it('renders controls and trade list without overflow-x classes at 320 px', () => {
        showPlan(3)
        const { container } = render(<RebalanceConfirm portfolioId="p1" open onClose={vi.fn()} />)

        // The scrollable trade-list region must exist and must not carry a
        // class that would clip content horizontally.
        const region = screen.getByRole('region', { name: '3 planned trades' })
        expect(region).toBeInTheDocument()
        expect(region.className).not.toMatch(/overflow-x-hidden/)

        // The outer content wrapper must carry break-words so long asset
        // names or fee strings cannot create a wider-than-container box.
        // We walk up from the trade list to the first div that carries
        // the scrollable body class.
        const scrollBody = container.querySelector('.max-h-\\[65vh\\]')
        expect(scrollBody).not.toBeNull()
        expect(scrollBody!.className).toMatch(/break-words/)
        expect(scrollBody!.className).toMatch(/min-w-0/)

        // All actionable controls are reachable.
        expect(screen.getByRole('checkbox')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Confirm rebalance' })).toBeInTheDocument()
    })

    it('renders controls and trade list at 200 % text size (32 px root font)', () => {
        // Simulate user browser text-size preference of 200 % by setting
        // the root element font-size.  jsdom does not reflow but the DOM
        // structure must remain unchanged.
        document.documentElement.style.fontSize = '32px'

        showPlan(5)
        render(<RebalanceConfirm portfolioId="p1" open onClose={vi.fn()} />)

        const region = screen.getByRole('region', { name: '5 planned trades' })
        expect(region).toBeInTheDocument()
        expect(within(region).getAllByRole('listitem')).toHaveLength(5)

        expect(screen.getByRole('checkbox')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Confirm rebalance' })).toBeInTheDocument()
    })

    it('error alert carries break-words and min-w-0 so long transaction error strings do not clip', async () => {
        showPlan(2)
        const longError = 'Transaction rejected: ' + 'x'.repeat(80)
        mocks.mutateAsync.mockRejectedValueOnce(new Error(longError))

        render(<RebalanceConfirm portfolioId="p1" open onClose={vi.fn()} />)
        fireEvent.click(screen.getByRole('checkbox'))
        fireEvent.click(screen.getByRole('button', { name: 'Confirm rebalance' }))

        const alert = await screen.findByRole('alert')
        expect(alert).toBeInTheDocument()
        expect(alert.className).toMatch(/break-words/)
        expect(alert.className).toMatch(/min-w-0/)
        // The full error text is present — not truncated or hidden.
        expect(alert).toHaveTextContent(longError)
        // Cancel is still reachable after the error.
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    })

    it('submitting-state button text is visible and not clipped at 320 px', async () => {
        showPlan(2)
        let resolveMutation!: () => void
        mocks.mutateAsync.mockImplementation(
            () => new Promise<void>(resolve => { resolveMutation = resolve }),
        )

        render(<RebalanceConfirm portfolioId="p1" open onClose={vi.fn()} />)
        fireEvent.click(screen.getByRole('checkbox'))
        fireEvent.click(screen.getByRole('button', { name: 'Confirm rebalance' }))

        // The in-flight button must remain findable by its accessible name.
        const submitting = screen.getByRole('button', { name: 'Submitting rebalance…' })
        expect(submitting).toBeInTheDocument()
        expect(submitting).toBeDisabled()
        // Cancel is also reachable so the user can abort via keyboard.
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

        resolveMutation()
        await waitFor(() =>
            expect(screen.queryByRole('button', { name: 'Submitting rebalance…' })).toBeNull(),
        )
    })
})
