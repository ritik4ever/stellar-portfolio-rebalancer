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
})
