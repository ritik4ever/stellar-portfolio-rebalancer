import { describe, it, expect, vi, beforeEach } from 'vitest'
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

type BoundaryOverrides = Partial<{
    reasonCode: 'WITHIN_EVERY_THRESHOLD' | 'DRIFT_EXCEEDS_THRESHOLD' | 'TRADES_REQUIRED'
    thresholdPercent: number
    maxDriftPercent: number
}>

function showPlan(tradeCount: number, boundaryOverrides: BoundaryOverrides = {}) {
    mocks.useRebalancePlan.mockReturnValue({
        data: {
            maxSlippagePercent: 2,
            estimatedFees: { xlm: tradeCount * 0.001, usd: tradeCount * 0.01, tradeCount },
            boundary: {
                reasonCode: tradeCount ? 'TRADES_REQUIRED' : 'WITHIN_EVERY_THRESHOLD',
                thresholdPercent: 5,
                maxDriftPercent: tradeCount ? 7 : 2,
                ...boundaryOverrides,
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

    it('explains the inclusive drift boundary and read-only no-trade preview', () => {
        showPlan(0, { thresholdPercent: 5, maxDriftPercent: 2 })
        render(<RebalanceConfirm portfolioId="p1" open onClose={vi.fn()} />)

        const status = screen.getByRole('status')
        expect(status).toHaveTextContent('0 planned trades — read-only preview')
        expect(status).toHaveTextContent('Largest observed drift is 2.00 percentage points')
        expect(status).toHaveTextContent('Allowed drift is ±5.00 percentage points or less from target (inclusive)')
        expect(status).toHaveTextContent('exactly at ±5.00 percentage points is still inside the threshold')
        expect(status).toHaveTextContent('only absolute drift above 5.00 percentage points is traded')
        expect(screen.queryByRole('region', { name: /planned trades/i })).toBeNull()
        expect(screen.queryByRole('checkbox')).toBeNull()
        expect(screen.queryByRole('button', { name: 'Confirm rebalance' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-describedby', 'dry-run-boundary-status')
    })

    it('treats drift exactly at the threshold as inside the boundary', () => {
        showPlan(0, { thresholdPercent: 5, maxDriftPercent: 5 })
        render(<RebalanceConfirm portfolioId="p1" open onClose={vi.fn()} />)

        const status = screen.getByRole('status')
        expect(status).toHaveTextContent('Largest observed drift is 5.00 percentage points')
        expect(status).toHaveTextContent('exactly at ±5.00 percentage points is still inside the threshold')
        expect(status).toHaveTextContent('No trades are required and there is no network fee')
    })

    it('does not describe a no-trade plan as within threshold when drift exceeded it', () => {
        showPlan(0, { reasonCode: 'DRIFT_EXCEEDS_THRESHOLD', thresholdPercent: 5, maxDriftPercent: 6 })
        render(<RebalanceConfirm portfolioId="p1" open onClose={vi.fn()} />)

        const status = screen.getByRole('status')
        expect(status).toHaveTextContent('no executable trades')
        expect(status).not.toHaveTextContent('inside the threshold')
        expect(screen.queryByRole('button', { name: 'Confirm rebalance' })).toBeNull()
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
        expect(screen.queryByText(/read-only preview/i)).toBeNull()
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
