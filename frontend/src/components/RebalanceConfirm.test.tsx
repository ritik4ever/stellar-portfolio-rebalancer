import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import RebalanceConfirm from './RebalanceConfirm'

const mocks = vi.hoisted(() => ({
  useRebalanceEstimate: vi.fn(),
  useRebalancePlan: vi.fn(),
  useExecuteRebalanceMutation: vi.fn(),
}))

vi.mock('../hooks/queries/usePortfolioQuery', () => ({
  useRebalanceEstimate: mocks.useRebalanceEstimate,
  useRebalancePlan: mocks.useRebalancePlan,
}))

vi.mock('../hooks/mutations/usePortfolioMutations', () => ({
  useExecuteRebalanceMutation: mocks.useExecuteRebalanceMutation,
}))

vi.mock('./ui/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  ButtonProps: {} as any,
}))

const mockEstimate = {
  trades: [
    { fromAsset: 'XLM', toAsset: 'USDC', amount: 100, expectedPrice: 0.12, estimatedSlippageBps: 50 },
    { fromAsset: 'BTC', toAsset: 'XLM', amount: 0.5, expectedPrice: 60000, estimatedSlippageBps: 800 },
  ],
  gasEstimateXlm: 0.02,
  gasEstimateUsd: 0.05,
  maxSlippageBps: 100,
  estimatedSlippageBps: 60,
  tradeCount: 2,
  gasWarning: false,
}

function setup(overrides: Record<string, any> = {}) {
  mocks.useRebalanceEstimate.mockReturnValue({
    data: mockEstimate,
    isLoading: false,
    ...overrides,
  })
  mocks.useRebalancePlan.mockReturnValue({
    data: { maxSlippagePercent: 1 },
    isLoading: false,
  })
  mocks.useExecuteRebalanceMutation.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  })
}

beforeEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RebalanceConfirm', () => {
  it('renders the confirm dialog when open', () => {
    setup()
    render(<RebalanceConfirm portfolioId="p1" open={true} onClose={vi.fn()} />)
    expect(screen.getByText('Review rebalance')).toBeTruthy()
  })

  it('returns null when not open', () => {
    setup()
    const { container } = render(<RebalanceConfirm portfolioId="p1" open={false} onClose={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows loading state', () => {
    setup()
    mocks.useRebalanceEstimate.mockReturnValue({ data: undefined, isLoading: true })
    render(<RebalanceConfirm portfolioId="p1" open={true} onClose={vi.fn()} />)
    expect(screen.getByText('Loading rebalance estimate...')).toBeTruthy()
  })

  it('shows high slippage warning when a leg exceeds threshold', () => {
    setup()
    render(
      <RebalanceConfirm
        portfolioId="p1"
        open={true}
        onClose={vi.fn()}
        maxSlippageThresholdBps={500}
      />
    )
    expect(screen.getByText('High slippage detected')).toBeTruthy()
    expect(screen.getByText(/BTC.*→.*XLM/)).toBeTruthy()
  })
})
