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

  it('recovers from wallet signature rejection with an actionable retry without duplicating', async () => {
    const onSuccess = vi.fn()
    mockMutateAsync.mockRejectedValueOnce(new Error('User rejected signing in wallet'))

    renderReview({ onSuccess })

    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )
    await userEvent.click(screen.getByRole('button', { name: /confirm rebalance/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/wallet signature rejected/i)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/no transaction was submitted/i)

    let resolveRetry: (value: unknown) => void = () => {}
    mockMutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve
        }),
    )

    const retryBtn = screen.getByRole('button', { name: /retry signing/i })
    fireEvent.click(retryBtn)
    fireEvent.click(retryBtn)

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      resolveRetry({ ok: true })
    })

    expect(mockMutateAsync).toHaveBeenCalledTimes(2)
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('blocks blind resubmission on lost network acknowledgement until status is checked', async () => {
    const onSuccess = vi.fn()
    mockMutateAsync.mockRejectedValueOnce(new Error('Network timeout: acknowledgement lost'))

    renderReview({ onSuccess })

    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )
    await userEvent.click(screen.getByRole('button', { name: /confirm rebalance/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/network acknowledgement lost/i)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/may have already been submitted/i)

    // Even if the user re-checks the acknowledgement, Confirm rebalance stays disabled
    // until status is checked to prevent duplicate trades.
    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )
    expect(screen.getByRole('button', { name: /confirm rebalance/i })).toBeDisabled()

    await userEvent.click(
      screen.getByRole('button', { name: /check status & refresh plan/i }),
    )
    expect(mockRefetch).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    // After checking status and seeing trades are still needed, user can safely retry.
    mockMutateAsync.mockResolvedValueOnce({ ok: true })
    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )
    await userEvent.click(screen.getByRole('button', { name: /confirm rebalance/i }))

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(2)
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps generic non-slippage failures reviewable and retryable', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Unexpected server error'))

    renderReview()

    await userEvent.click(
      screen.getByRole('checkbox', { name: /i reviewed the planned trades/i }),
    )
    await userEvent.click(screen.getByRole('button', { name: /confirm rebalance/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/unexpected server error/i)
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
})
