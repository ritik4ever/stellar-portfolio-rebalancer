import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import BacktestPage from '../Backtest'

const mockMutate = vi.hoisted(() => vi.fn())
const mockUseBacktestMutation = vi.hoisted(() => vi.fn())

vi.mock('../../hooks/mutations/useBacktestMutation', () => ({
    useBacktestMutation: mockUseBacktestMutation,
}))

vi.mock('recharts', async () => {
    const actual = await vi.importActual<typeof import('recharts')>('recharts')
    return {
        ...actual,
        ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    }
})

const DAY = 24 * 60 * 60

const mockResult = {
    threshold: 5,
    allocations: { XLM: 40, BTC: 30, USDC: 30 },
    startTimestamp: 1_700_006_400,
    endTimestamp: 1_700_006_400 + 2 * DAY,
    days: 3,
    initialValue: 10000,
    finalValue: 11250,
    totalReturnPct: 12.5,
    buyAndHoldFinalValue: 10000,
    buyAndHoldReturnPct: 0,
    rebalanceCount: 1,
    maxDrawdownPct: 3.2,
    maxDriftObservedPct: 16.67,
    events: [{ timestamp: 1_700_006_400 + DAY, maxDriftPct: 16.67, asset: 'XLM', portfolioValue: 15000 }],
    timeline: [
        { timestamp: 1_700_006_400, value: 10000, buyAndHoldValue: 10000, maxDriftPct: 0, rebalanced: false },
        { timestamp: 1_700_006_400 + DAY, value: 15000, buyAndHoldValue: 15000, maxDriftPct: 16.67, rebalanced: true },
        { timestamp: 1_700_006_400 + 2 * DAY, value: 11250, buyAndHoldValue: 10000, maxDriftPct: 16.67, rebalanced: false },
    ],
    simulated: true,
    dataSource: 'coingecko_market_chart',
    disclaimer: 'Historical simulation only.',
}

const idleMutation = { mutate: mockMutate, isPending: false, isError: false, error: null, data: undefined }

describe('BacktestPage', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockUseBacktestMutation.mockReturnValue(idleMutation)
    })

    it('labels the view as a historical simulation, not a guarantee', () => {
        render(<BacktestPage onNavigate={vi.fn()} />)
        expect(screen.getByRole('note').textContent).toMatch(/historical simulation, not a guarantee/i)
    })

    it('submits the allocation, threshold and period', () => {
        render(<BacktestPage onNavigate={vi.fn()} />)
        fireEvent.change(screen.getByRole('slider'), { target: { value: '12' } })
        fireEvent.change(screen.getByRole('combobox'), { target: { value: '180' } })
        fireEvent.click(screen.getByRole('button', { name: /run simulation/i }))

        expect(mockMutate).toHaveBeenCalledWith({
            allocations: { XLM: 40, BTC: 30, USDC: 30 },
            threshold: 12,
            days: 180,
        })
    })

    it('blocks submission when allocations do not sum to 100%', () => {
        render(<BacktestPage onNavigate={vi.fn()} />)
        fireEvent.change(screen.getByLabelText('XLM allocation percent'), { target: { value: '10' } })

        expect(screen.getByRole('alert').textContent).toMatch(/must sum to 100%/)
        expect((screen.getByRole('button', { name: /run simulation/i }) as HTMLButtonElement).disabled).toBe(true)
    })

    it('renders results against buy-and-hold with rebalance events', () => {
        mockUseBacktestMutation.mockReturnValue({ ...idleMutation, data: mockResult })
        render(<BacktestPage onNavigate={vi.fn()} />)

        expect(screen.getByText('Rebalanced at 5%')).toBeTruthy()
        expect(screen.getByText('+12.50%')).toBeTruthy()
        expect(screen.getAllByText('Buy and hold').length).toBeGreaterThan(0)
        expect(screen.getByText('Rebalance events')).toBeTruthy()
        expect(screen.getByText('Historical simulation only.')).toBeTruthy()
    })

    it('surfaces an error when historical data is unavailable', () => {
        mockUseBacktestMutation.mockReturnValue({
            ...idleMutation,
            isError: true,
            error: new Error('Historical prices unavailable for XLM'),
        })
        render(<BacktestPage onNavigate={vi.fn()} />)
        expect(screen.getByRole('alert').textContent).toMatch(/Historical prices unavailable for XLM/)
    })
})
