import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import PerformanceChart from './PerformanceChart'

const mocks = vi.hoisted(() => ({
    usePortfolioAnalytics: vi.fn(),
    usePerformanceSummary: vi.fn(),
    usePortfolioBenchmark: vi.fn(),
    useRebalanceHistory: vi.fn(),
}))

vi.mock('../hooks/queries/useAnalyticsQuery', () => ({
    usePortfolioAnalytics: mocks.usePortfolioAnalytics,
    usePerformanceSummary: mocks.usePerformanceSummary,
    usePortfolioBenchmark: mocks.usePortfolioBenchmark,
}))
vi.mock('../hooks/queries/useHistoryQuery', () => ({ useRebalanceHistory: mocks.useRebalanceHistory }))
vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ isDark: false }) }))
vi.mock('recharts', () => {
    const Empty = () => null
    return {
        LineChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
            <div data-testid="line-chart" data-length={data.length}>{children}</div>
        ),
        Line: ({ dot }: { dot: unknown }) => <div data-testid="line" data-dot={dot ? 'visible' : 'hidden'} />,
        ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        XAxis: Empty, YAxis: Empty, CartesianGrid: Empty, Tooltip: Empty, Legend: Empty,
        ReferenceDot: Empty, BarChart: Empty, Bar: Empty, Cell: Empty,
    }
})

const idle = (data: unknown) => ({ data, isLoading: false, error: null })
const point = (day: number, totalValue: unknown = 1000) => ({
    timestamp: `2026-01-0${day}T00:00:00.000Z`,
    totalValue,
})

describe('PerformanceChart series boundaries', () => {
    beforeEach(() => {
        mocks.usePerformanceSummary.mockReturnValue(idle(null))
        mocks.usePortfolioBenchmark.mockReturnValue(idle({ benchmarks: [] }))
        mocks.useRebalanceHistory.mockReturnValue(idle({ history: [] }))
    })

    afterEach(() => {
        cleanup()
        vi.clearAllMocks()
    })

    it('explains an empty series for the selected range', () => {
        mocks.usePortfolioAnalytics.mockReturnValue(idle({ data: [] }))
        render(<PerformanceChart portfolioId="p1" />)
        fireEvent.click(screen.getByRole('button', { name: 'Show 1 week' }))

        expect(screen.getByRole('status').textContent).toContain('1W (last 7 days): 0 price points')
        expect(screen.getByRole('status').textContent).toContain('at least 2 price points')
        expect(screen.queryByTestId('line-chart')).toBeNull()
        expect(screen.getByRole('button', { name: 'Show 1 week' }).getAttribute('aria-pressed')).toBe('true')
    })

    it('draws a visible dot for a single price point', () => {
        mocks.usePortfolioAnalytics.mockReturnValue(idle({ data: [point(1)] }))
        render(<PerformanceChart portfolioId="p1" />)

        expect(screen.getByRole('status').textContent).toContain('1D (last 1 day): 1 price point')
        expect(screen.getByRole('status').textContent).toContain('shown as one dot')
        expect(screen.getByTestId('line').getAttribute('data-dot')).toBe('visible')
        expect(screen.getByRole('img').getAttribute('aria-label')).toContain('one price point for 1D')
    })

    it('does not plot an incomplete snapshot as a zero next to a single point', () => {
        mocks.usePortfolioAnalytics.mockReturnValue(idle({ data: [point(1, null), point(2)] }))
        render(<PerformanceChart portfolioId="p1" />)

        expect(screen.getByTestId('line-chart').getAttribute('data-length')).toBe('1')
        expect(screen.getByRole('status').textContent).toContain('1 incomplete snapshot is not counted.')
    })

    it('treats a series with only incomplete snapshots as empty', () => {
        mocks.usePortfolioAnalytics.mockReturnValue(idle({ data: [point(1, null)] }))
        render(<PerformanceChart portfolioId="p1" />)

        expect(screen.queryByTestId('line-chart')).toBeNull()
        expect(screen.getByText('No performance data available yet')).toBeTruthy()
    })

    it('keeps a line without dots at two points', () => {
        mocks.usePortfolioAnalytics.mockReturnValue(idle({ data: [point(1), point(2, 1100)] }))
        render(<PerformanceChart portfolioId="p1" />)

        expect(screen.getByTestId('line').getAttribute('data-dot')).toBe('hidden')
        expect(screen.getByRole('status').textContent).toContain('2 price points')
    })

    it('keeps the range selector available while loading and after an error', () => {
        mocks.usePortfolioAnalytics.mockReturnValue({ data: undefined, isLoading: true, error: null })
        const { rerender } = render(<PerformanceChart portfolioId="p1" />)
        expect(screen.getByRole('button', { name: 'Show 1 month' })).toBeTruthy()

        mocks.usePortfolioAnalytics.mockReturnValue({ data: undefined, isLoading: false, error: new Error('down') })
        rerender(<PerformanceChart portfolioId="p1" />)
        expect(screen.getByRole('alert')).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Show 1 month' })).toBeTruthy()
    })
})
