import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import Compare from '../Compare'

const mockPortfolios = [
  { id: 'portfolio-1', name: 'Growth Portfolio', totalValue: 50000, allocations: { BTC: 50, ETH: 30, XLM: 20 } },
  { id: 'portfolio-2', name: 'Income Portfolio', totalValue: 75000, allocations: { BTC: 30, ETH: 40, XLM: 30 } },
  { id: 'portfolio-3', name: 'Balanced Portfolio', totalValue: 60000, allocations: { BTC: 40, ETH: 35, XLM: 25 } },
  { id: 'portfolio-4', name: 'Aggressive Portfolio', totalValue: 90000, allocations: { BTC: 70, ETH: 20, XLM: 10 } },
  { id: 'portfolio-5', name: 'Conservative Portfolio', totalValue: 30000, allocations: { BTC: 20, ETH: 25, XLM: 55 } },
]

const mockCompareData = {
  portfolios: [
    { portfolioId: 'portfolio-1', name: 'Growth Portfolio', totalReturnPct: 12.5, volatility: 15.2, maxDrawdown: -8.1, sharpeRatio: 1.2, rebalanceCount: 4, totalValue: 50000 },
    { portfolioId: 'portfolio-2', name: 'Income Portfolio', totalReturnPct: 8.3, volatility: 10.5, maxDrawdown: -5.2, sharpeRatio: 0.9, rebalanceCount: 6, totalValue: 75000 },
    { portfolioId: 'portfolio-3', name: 'Balanced Portfolio', totalReturnPct: 10.1, volatility: 12.8, maxDrawdown: -6.5, sharpeRatio: 1.1, rebalanceCount: 5, totalValue: 60000 },
  ],
  timeRange: { from: '2024-01-01', to: '2024-12-31' },
}

const mockUseSearchParams = vi.hoisted(() => vi.fn(() => [new URLSearchParams(), vi.fn()]))
const mockUseUserPortfolios = vi.hoisted(() => vi.fn())
const mockUsePortfolioCompare = vi.hoisted(() => vi.fn())
const mockUseTranslation = vi.hoisted(() => () => ({ t: (key: string) => { const keys: Record<string, string> = { 'compare.title': 'Compare Portfolios', 'compare.subtitle': 'Select portfolios', 'compare.selectPortfolios': 'selected', 'compare.allocation': 'Allocation', 'compare.metrics': 'Metrics', 'compare.noPortfolios': 'No portfolios found', 'compare.selectAtLeastTwo': 'Select at least two portfolios' }; return keys[key] || key } }))

vi.mock('react-router-dom', () => ({ useSearchParams: mockUseSearchParams }))
vi.mock('../../hooks/queries/usePortfolioQuery', () => ({ useUserPortfolios: mockUseUserPortfolios }))
vi.mock('../../hooks/queries/useAnalyticsQuery', () => ({ usePortfolioCompare: mockUsePortfolioCompare }))
vi.mock('react-i18next', () => ({ useTranslation: mockUseTranslation }))

describe('Compare', () => {
  const onNavigate = vi.fn()

  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockUseSearchParams.mockReturnValue([new URLSearchParams(), vi.fn()])
    mockUseUserPortfolios.mockReturnValue({ data: mockPortfolios })
    mockUsePortfolioCompare.mockReturnValue({ data: mockCompareData, isLoading: false, error: null })
  })

  it('requires a connected wallet', () => {
    render(<Compare onNavigate={onNavigate} publicKey={null} />)
    expect(screen.getByText('Connect wallet to compare portfolios')).toBeTruthy()
  })

  it('renders portfolio selection grid when wallet is connected', () => {
    render(<Compare onNavigate={onNavigate} publicKey={'GA-test-key'} />)
    expect(screen.getByText('Growth Portfolio')).toBeTruthy()
    expect(screen.getByText('Income Portfolio')).toBeTruthy()
    expect(screen.getByText('Balanced Portfolio')).toBeTruthy()
    expect(screen.getByText('Aggressive Portfolio')).toBeTruthy()
    expect(screen.getByText('Conservative Portfolio')).toBeTruthy()
  })

  it('allows selecting up to 5 portfolios and shows correct count', () => {
    render(<Compare onNavigate={onNavigate} publicKey={'GA-test-key'} />)

    const allCards = mockPortfolios.map(p => screen.getByText(p.name).closest('div'))
    for (const card of allCards) {
      if (card) fireEvent.click(card)
    }

    expect(screen.getByText('5/5 selected')).toBeTruthy()
  })

  it('renders comparison table for 3 portfolios', async () => {
    render(<Compare onNavigate={onNavigate} publicKey={'GA-test-key'} />)

    const card1 = screen.getByText('Growth Portfolio').closest('div')
    const card2 = screen.getByText('Income Portfolio').closest('div')
    const card3 = screen.getByText('Balanced Portfolio').closest('div')
    if (card1) fireEvent.click(card1)
    if (card2) fireEvent.click(card2)
    if (card3) fireEvent.click(card3)

    await waitFor(() => {
      expect(mockUsePortfolioCompare).toHaveBeenCalled()
      expect(screen.getByText('Total Return')).toBeTruthy()
      expect(screen.getByText('Volatility')).toBeTruthy()
      expect(screen.getByText('Max Drawdown')).toBeTruthy()
      expect(screen.getByText('Sharpe Ratio')).toBeTruthy()
      expect(screen.getByText('Rebalance Count')).toBeTruthy()
      expect(screen.getByText('Portfolio Value')).toBeTruthy()
    })
  })
})
