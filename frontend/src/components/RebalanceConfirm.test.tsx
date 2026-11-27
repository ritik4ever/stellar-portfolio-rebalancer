import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ---------------------------------------------------------------------------
// Query / mutation hook doubles (hoisted before the component is imported).
// ---------------------------------------------------------------------------
const mockUseRebalancePlan = vi.fn()
const mockUsePortfolioDetails = vi.fn()
const mockMutateAsync = vi.fn()
let mockRefetch: ReturnType<typeof vi.fn>

vi.mock('../hooks/queries/usePortfolioQuery', () => ({
  useRebalancePlan: (...args: unknown[]) => mockUseRebalancePlan(...args),
  usePortfolioDetails: (...args: unknown[]) => mockUsePortfolioDetails(...args),
}))

vi.mock('../hooks/mutations/usePortfolioMutations', () => ({
  useExecuteRebalanceMutation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

import RebalanceConfirm from './RebalanceConfirm'
import { ApiClientError } from '../config/api'

const NOW = new Date('2026-04-01T12:00:00.000Z').getTime()

function makeTrades() {
  return [
    { asset: 'XLM', action: 'buy' as const, amount: 100 },
    { asset: 'USDC', action: 'sell' as const, amount: 50 },
  ]
}

function makePlan(overrides: Record<string, unknown> = {}) {
  return {
    portfolioId: 'p1',
    totalValue: 1000,
    maxSlippagePercent: 1,
    estimatedSlippageBps: 100,
    estimatedFees: { xlm: 0.0005, usd: 0.0001, tradeCount: 2 },
    boundary: {
      reasonCode: 'TRADES_REQUIRED',
      trades: makeTrades(),
      quoteSnapshot: {
        prices: {
          XLM: { timestamp: NOW / 1000 },
          USDC: { timestamp: NOW / 1000 - 60 },
        },
        feedMeta: { degraded: false, staleOrLimited: false },
      },
    },
    ...overrides,
  }
}

function planResult(plan: unknown, overrides: Record<string, unknown> = {}) {
  return {
    data: plan,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
    ...overrides,
  }
}

function detailsResult(tolerance: number | null) {
  return {
    data: tolerance == null ? undefined : { slippageTolerancePercent: tolerance },
    isLoading: false,
  }
}

function renderReview(overrides: Record<string, unknown> = {}) {
  return render(
    <RebalanceConfirm
      portfolioId="p1"
      open
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  mockUseRebalancePlan.mockReset()
  mockUsePortfolioDetails.mockReset()
  mockMutateAsync.mockReset()
  mockRefetch = vi.fn().mockResolvedValue({ data: makePlan() })

  mockUseRebalancePlan.mockReturnValue(planResult(makePlan()))
  mockUsePortfolioDetails.mockReturnValue(detailsResult(1))
  mockMutateAsync.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RebalanceConfirm — review and acknowledgement', () => {
  it('renders every planned trade and gates confirmation on acknowledgement', async () => {
    renderReview()

    expect(screen.getByText(/Buy 100/)).toHaveTextContent(/XLM/)
    expect(screen.getByText(/Sell 50/)).toHaveTextContent(/USDC/)
    expect(screen.getByText(/estimated network fee/i)).toBeInTheDocument()
    expect(screen.getByText(/maximum slippage: 1%/i)).toBeInTheDocument()

    const confirm = screen.getByRole('button', { name: /confirm rebalance/i })
    expect(confirm).toBeDisabled()

    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )

    expect(confirm).toBeEnabled()
  })

  it('shows a read-only close-only view when there are no trades', () => {
    mockUseRebalancePlan.mockReturnValue(
      planResult(
        makePlan({
          boundary: {
            reasonCode: 'WITHIN_EVERY_THRESHOLD',
            trades: [],
            quoteSnapshot: {
              prices: {},
              feedMeta: { degraded: false, staleOrLimited: false },
            },
          },
        }),
      ),
    )

    renderReview()

    expect(screen.getByText(/0 planned trades/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /confirm rebalance/i }),
    ).not.toBeInTheDocument()
  })
})

describe('RebalanceConfirm — slippage tolerance changes before approval', () => {
  it('blocks confirmation and offers a refresh when the portfolio tolerance no longer matches the plan', async () => {
    mockUsePortfolioDetails.mockReturnValue(detailsResult(2))

    const { rerender } = renderReview()

    expect(
      screen.getByText(/slippage tolerance changed after this plan was quoted/i),
    ).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )
    expect(screen.getByRole('button', { name: /confirm rebalance/i })).toBeDisabled()

    const refresh = screen.getByRole('button', { name: /refresh plan/i })
    await userEvent.click(refresh)

    expect(mockRefetch).toHaveBeenCalled()

    // The refreshed plan reflects the new tolerance and unblocks confirmation.
    mockUseRebalancePlan.mockReturnValue(planResult(makePlan({ maxSlippagePercent: 2 })))
    rerender(
      <RebalanceConfirm portfolioId="p1" open onClose={vi.fn()} onSuccess={vi.fn()} />,
    )

    expect(
      screen.queryByText(/slippage tolerance changed after this plan was quoted/i),
    ).not.toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )
    expect(screen.getByRole('button', { name: /confirm rebalance/i })).toBeEnabled()
  })
})

describe('RebalanceConfirm — execution failure recovery', () => {
  it('explains a slippage rejection and refreshes the quote for a safe retry', async () => {
    const onSuccess = vi.fn()
    mockMutateAsync.mockRejectedValueOnce(
      new Error('Slippage tolerance exceeded: price moved before execution'),
    )

    renderReview({ onSuccess })

    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )
    await userEvent.click(screen.getByRole('button', { name: /confirm rebalance/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/slippage tolerance exceeded/i)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      /prices moved beyond your slippage limit/i,
    )
    expect(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    ).not.toBeChecked()

    const { refetch } = mockUseRebalancePlan.mock.results[0].value
    await userEvent.click(
      screen.getByRole('button', { name: /refresh quote and retry/i }),
    )
    expect(mockRefetch).toHaveBeenCalledTimes(1)

    // The failure alert is cleared and the user can re-acknowledge and retry.
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )
    await userEvent.click(screen.getByRole('button', { name: /confirm rebalance/i }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(2)
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps non-slippage failures reviewable and retryable', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('network down'))

    renderReview()

    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )
    await userEvent.click(screen.getByRole('button', { name: /confirm rebalance/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/network down/i)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      /review and re-acknowledge the planned trades to retry/i,
    )
    expect(screen.queryByRole('button', { name: /refresh quote and retry/i })).not.toBeInTheDocument()

    mockMutateAsync.mockResolvedValueOnce({ ok: true })
    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )
    await userEvent.click(screen.getByRole('button', { name: /confirm rebalance/i }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(2)
    })
  })
})

describe('RebalanceConfirm — duplicate submission guard', () => {
  it('submits once on a rapid double-click and announces in-flight status', async () => {
    let resolveSubmit: (value: unknown) => void = () => {}
    mockMutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve
        }),
    )

    renderReview()

    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )

    const confirm = screen.getByRole('button', { name: /confirm rebalance/i })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/submitting rebalance/i)
    })
    expect(mockMutateAsync).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSubmit({ ok: true })
    })

    expect(mockMutateAsync).toHaveBeenCalledTimes(1)
  })

  it('explains the submit control state before and after acknowledgement', async () => {
    renderReview()
    expect(screen.getByText(/check the review box to enable confirm/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }))
    expect(screen.getByText(/click confirm once/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm rebalance/i })).toHaveAttribute('aria-describedby', 'rebalance-submit-hint')
  })

  it('treats a failed final execution status as an error and keeps the modal open', async () => {
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    mockMutateAsync.mockResolvedValue({ result: { status: 'failed', failureReason: 'Pool dry', txId: 'abc123' } })
    renderReview({ onSuccess, onClose })
    await userEvent.click(screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm rebalance/i }))
    expect(await screen.findByText(/Pool dry \(TX: abc123\)/)).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('RebalanceConfirm — narrow widths (320px) and 200% text sizing', () => {
  let originalInnerWidth: number
  let originalFontSize: string

  beforeEach(() => {
    originalInnerWidth = window.innerWidth
    originalFontSize = document.documentElement.style.fontSize
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 320,
    })
    document.documentElement.style.fontSize = '200%'
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    })
    document.documentElement.style.fontSize = originalFontSize
  })

  it('keeps predicted trade list, acknowledgement, and controls operable without horizontal clipping', async () => {
    mockUseRebalancePlan.mockReturnValue(
      planResult(
        makePlan({
          boundary: {
            reasonCode: 'TRADES_REQUIRED',
            trades: [
              { asset: 'SUPERLONGASSETIDENTIFIER', action: 'buy' as const, amount: 1234567.8901234 },
              { asset: 'USDC', action: 'sell' as const, amount: 50000 },
            ],
            quoteSnapshot: {
              prices: {
                SUPERLONGASSETIDENTIFIER: { timestamp: NOW / 1000 },
                USDC: { timestamp: NOW / 1000 - 60 },
              },
              feedMeta: { degraded: false, staleOrLimited: false },
            },
          },
        }),
      ),
    )

    renderReview()

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('overflow-x-hidden')
    expect(dialog.className).toContain('overflow-y-auto')
    expect(dialog.className).toContain('min-w-0')

    const tradeRegion = screen.getByRole('region', { name: /2 planned trades/i })
    expect(tradeRegion.className).toContain('overflow-x-hidden')
    expect(tradeRegion.className).toContain('overflow-y-auto')
    expect(tradeRegion.className).toContain('min-w-0')
    expect(tradeRegion).toHaveTextContent(/SUPERLONGASSETIDENTIFIER/)

    const checkbox = screen.getByRole('checkbox', { name: /i reviewed the planned trades/i })
    expect(checkbox.className).toContain('shrink-0')
    await userEvent.click(checkbox)

    const confirm = screen.getByRole('button', { name: /confirm rebalance/i })
    const cancel = screen.getByRole('button', { name: /cancel/i })
    expect(confirm).toBeEnabled()
    expect(confirm.className).toContain('max-w-full')
    expect(confirm.className).toContain('break-words')
    expect(cancel.className).toContain('max-w-full')
    expect(cancel.parentElement?.className).toContain('flex-wrap')
  })

  it('keeps read-only zero-trade status and close control visible and operable without horizontal clipping', async () => {
    const onClose = vi.fn()
    mockUseRebalancePlan.mockReturnValue(
      planResult(
        makePlan({
          boundary: {
            reasonCode: 'WITHIN_EVERY_THRESHOLD',
            thresholdPercent: 5,
            maxDriftPercent: 5,
            trades: [],
            quoteSnapshot: {
              prices: {},
              feedMeta: { degraded: false, staleOrLimited: false },
            },
          },
        }),
      ),
    )

    renderReview({ onClose })

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/0 planned trades — read-only preview/i)
    expect(status.className).toContain('overflow-x-hidden')
    expect(status.className).toContain('overflow-y-auto')
    expect(status.className).toContain('break-words')
    expect(status.className).toContain('min-w-0')

    const closeButton = screen.getByRole('button', { name: /close/i })
    expect(closeButton).toBeEnabled()
    expect(closeButton.className).toContain('max-w-full')
    expect(screen.queryByRole('button', { name: /confirm rebalance/i })).not.toBeInTheDocument()

    await userEvent.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('RebalanceConfirm — dry-run simulation timeout recovery', () => {
  it('shows an actionable timeout recovery path and recovers cleanly on retry without duplicating requests', async () => {
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    let resolveRefetch: (value: unknown) => void = () => {}
    mockRefetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefetch = resolve
        }),
    )

    mockUseRebalancePlan.mockReturnValue(
      planResult(undefined, {
        isError: true,
        error: new ApiClientError('Request timeout after 15000ms', 408, 'REQUEST_TIMEOUT'),
      }),
    )

    const { rerender } = renderReview({ onClose, onSuccess })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/simulation request timed out/i)
    expect(alert).toHaveTextContent(/no preview result is shown/i)
    expect(screen.queryByRole('button', { name: /confirm rebalance/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^cancel$/i })).toHaveLength(1)

    const retry = screen.getByRole('button', { name: /retry simulation/i })
    fireEvent.click(retry)
    fireEvent.click(retry)

    expect(mockRefetch).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/retrying dry-run simulation/i)
    })

    await act(async () => {
      resolveRefetch({ data: makePlan() })
    })

    mockUseRebalancePlan.mockReturnValue(planResult(makePlan()))
    rerender(
      <RebalanceConfirm portfolioId="p1" open onClose={onClose} onSuccess={onSuccess} />,
    )

    expect(screen.queryByText(/simulation request timed out/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Buy 100/)).toHaveTextContent(/XLM/)

    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )
    await userEvent.click(screen.getByRole('button', { name: /confirm rebalance/i }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(1)
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })

  it('recognizes gateway timeout errors and lets the user cancel without submitting or losing unrelated edits', async () => {
    const onClose = vi.fn()
    mockUseRebalancePlan.mockReturnValue(
      planResult(undefined, {
        isError: true,
        error: new ApiClientError('Gateway error', 504, 'GATEWAY_TIMEOUT'),
      }),
    )

    render(
      <div>
        <label htmlFor="unrelated-note">Portfolio note</label>
        <input id="unrelated-note" defaultValue="Keep 60/40 target" />
        <RebalanceConfirm portfolioId="p1" open onClose={onClose} onSuccess={vi.fn()} />
      </div>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/simulation request timed out/i)

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Portfolio note')).toHaveValue('Keep 60/40 target')
  })
})
