import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import AnalyticsPage from '../Analytics'

const mockUseUserPortfolios = vi.hoisted(() => vi.fn())
const mockPerformanceChart = vi.hoisted(() => vi.fn(() => null))

vi.mock('../../hooks/queries/usePortfolioQuery', () => ({
  useUserPortfolios: mockUseUserPortfolios,
}))

vi.mock('../../components/PerformanceChart', () => ({
  __esModule: true,
  default: mockPerformanceChart,
}))

const mockPortfolios = [
  { id: 'portfolio-1', name: 'Growth Portfolio', totalValue: 50000 },
  { id: 'portfolio-2', name: 'Income Portfolio', totalValue: 75000 },
]

describe('AnalyticsPage', () => {
  const onNavigate = vi.fn()

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockUseUserPortfolios.mockReturnValue({ data: mockPortfolios, isLoading: false })
    mockPerformanceChart.mockReturnValue(<div data-testid="performance-chart" />)
  })

  it('requires a connected wallet', () => {
    render(<AnalyticsPage onNavigate={onNavigate} publicKey={null} />)
    expect(screen.getByText('Connect a wallet to view portfolio analytics')).toBeTruthy()
    expect(screen.getByText('Connect Wallet')).toBeTruthy()
  })

  it('auto-selects the first portfolio and renders the performance chart', () => {
    render(<AnalyticsPage onNavigate={onNavigate} publicKey={'GA-test-key'} />)

    expect(screen.getByText('Portfolio Analytics')).toBeTruthy()
    expect(screen.getByTestId('performance-chart')).toBeTruthy()
    expect(mockPerformanceChart).toHaveBeenCalledWith(
      expect.objectContaining({ portfolioId: 'portfolio-1' }),
      expect.anything(),
    )
  })

  it('updates the chart when a different portfolio is selected', () => {
    render(<AnalyticsPage onNavigate={onNavigate} publicKey={'GA-test-key'} />)

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'portfolio-2' } })

    expect(mockPerformanceChart).toHaveBeenLastCalledWith(
      expect.objectContaining({ portfolioId: 'portfolio-2' }),
      expect.anything(),
    )
  })

  it('shows a create prompt when there are no portfolios', () => {
    mockUseUserPortfolios.mockReturnValue({ data: [], isLoading: false })

    render(<AnalyticsPage onNavigate={onNavigate} publicKey={'GA-test-key'} />)

    expect(screen.getByText(/No portfolios yet/)).toBeTruthy()
    expect(screen.getByText('Create Portfolio')).toBeTruthy()
  })
})
