import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import PriceCandlestick from './PriceCandlestick'

const mocks = vi.hoisted(() => ({
  usePriceCandlestick: vi.fn(),
  useRebalanceHistory: vi.fn(),
  useTheme: vi.fn(),
}))

vi.mock('../hooks/queries/usePriceCandlestickQuery', () => ({
  usePriceCandlestick: mocks.usePriceCandlestick,
}))

vi.mock('../hooks/queries/useHistoryQuery', () => ({
  useRebalanceHistory: mocks.useRebalanceHistory,
}))

vi.mock('../context/ThemeContext', () => ({
  useTheme: mocks.useTheme,
}))

vi.mock('recharts', () => ({
  ComposedChart: ({ children, data }: any) => (
    <div data-testid="composed-chart" data-candle-count={data.length}>{children}</div>
  ),
  Bar: ({ shape }: any) => <div data-testid="bar" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ReferenceLine: () => <div data-testid="reference-line" />,
  ReferenceDot: () => <div data-testid="reference-dot" />,
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
}))

const CANDLES_1H = Array.from({ length: 24 }, (_, i) => ({
  time: Date.now() - (23 - i) * 3600000,
  open: 0.12 + Math.random() * 0.01,
  high: 0.13 + Math.random() * 0.01,
  low: 0.11 + Math.random() * 0.01,
  close: 0.125 + Math.random() * 0.01,
  volume: 10000 + Math.random() * 5000,
}))

const CANDLES_1D = Array.from({ length: 30 }, (_, i) => ({
  time: Date.now() - (29 - i) * 86400000,
  open: 0.12 + Math.random() * 0.02,
  high: 0.14 + Math.random() * 0.02,
  low: 0.10 + Math.random() * 0.02,
  close: 0.125 + Math.random() * 0.02,
  volume: 100000 + Math.random() * 50000,
}))

beforeEach(() => {
  cleanup()
  vi.restoreAllMocks()
  sessionStorage.clear()
  mocks.useTheme.mockReturnValue({ isDark: false })
  mocks.useRebalanceHistory.mockReturnValue({
    data: { history: [] },
    isLoading: false,
    error: null,
  })
  mocks.usePriceCandlestick.mockReturnValue({
    data: { asset: 'XLM', interval: '1D', candles: CANDLES_1D },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
})

describe('PriceCandlestick', () => {
  it('renders the chart with asset name', () => {
    render(<PriceCandlestick asset="XLM" />)
    expect(screen.getByText('XLM Price')).toBeTruthy()
  })

  it('renders interval toggle buttons', () => {
    render(<PriceCandlestick asset="XLM" />)
    expect(screen.getByText('1H')).toBeTruthy()
    expect(screen.getByText('4H')).toBeTruthy()
    expect(screen.getByText('1D')).toBeTruthy()
    expect(screen.getByText('1W')).toBeTruthy()
  })

  it('re-renders with correct data when timeframe changes', () => {
    const { rerender } = render(<PriceCandlestick asset="XLM" />)

    mocks.usePriceCandlestick.mockReturnValue({
      data: { asset: 'XLM', interval: '1H', candles: CANDLES_1H },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })

    fireEvent.click(screen.getByText('1H'))

    expect(screen.getByTestId('composed-chart').getAttribute('data-candle-count')).toBe('24')
  })

  it('persists last-selected interval in sessionStorage', () => {
    const { rerender } = render(<PriceCandlestick asset="XLM" />)

    fireEvent.click(screen.getByText('1W'))

    expect(sessionStorage.getItem('priceCandlestickInterval')).toBe('1W')
  })

  it('shows loading state', () => {
    mocks.usePriceCandlestick.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    })
    render(<PriceCandlestick asset="XLM" />)
    expect(screen.getByLabelText('Loading candlestick chart')).toBeTruthy()
  })

  it('shows error state', () => {
    mocks.usePriceCandlestick.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    })
    render(<PriceCandlestick asset="XLM" />)
    expect(screen.getByText(/Failed to load price chart/)).toBeTruthy()
  })
})
