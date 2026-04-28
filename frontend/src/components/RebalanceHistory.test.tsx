import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import RebalanceHistory from './RebalanceHistory'

const { downloadCsvMock, toCsvMock, useHistoryMock } = vi.hoisted(() => ({
    downloadCsvMock: vi.fn(),
    toCsvMock: vi.fn(() => 'csv-content'),
    useHistoryMock: vi.fn()
}))

vi.mock('../utils/export', () => ({
    downloadCSV: downloadCsvMock,
    toCSV: toCsvMock
}))

vi.mock('../hooks/queries/useHistoryQuery', () => ({
    useRebalanceHistory: useHistoryMock
}))

describe('RebalanceHistory', () => {
    beforeEach(() => {
        cleanup()
        vi.restoreAllMocks()
        downloadCsvMock.mockReset()
        toCsvMock.mockClear()
        useHistoryMock.mockReset()
    })

    it('renders fetched history data', async () => {
        useHistoryMock.mockReturnValue({
            data: {
                history: [
                    {
                        id: 'e1',
                        timestamp: new Date().toISOString(),
                        trigger: 'Automatic Rebalancing',
                        trades: 2,
                        gasUsed: '0.02 XLM',
                        status: 'completed',
                        portfolioId: 'p1'
                    }
                ]
            },
            isLoading: false,
            error: null
        })

        render(<RebalanceHistory portfolioId="p1" />)

        expect(await screen.findByText('Automatic Rebalancing')).toBeTruthy()
        expect(screen.getByText(/2 trades/i)).toBeTruthy()
    })

    it('shows fallback error state', async () => {
        useHistoryMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') })

        render(<RebalanceHistory portfolioId="p1" />)

        expect(await screen.findByText(/Failed to load rebalance history/i)).toBeTruthy()
    })

    it('exports CSV when export button is clicked', async () => {
        useHistoryMock.mockReturnValue({
            data: {
                history: [
                    {
                        id: 'e2',
                        timestamp: new Date().toISOString(),
                        trigger: 'Manual Rebalance',
                        trades: 1,
                        gasUsed: '0.01 XLM',
                        status: 'completed',
                        portfolioId: 'p1'
                    }
                ]
            },
            isLoading: false,
            error: null
        })

        render(<RebalanceHistory portfolioId="p1" />)

        const button = await screen.findByRole('button', { name: /Export CSV/i })
        fireEvent.click(button)

        expect(toCsvMock).toHaveBeenCalled()
        expect(downloadCsvMock).toHaveBeenCalledWith(expect.stringMatching(/^rebalance_history_p1_/), 'csv-content')
    })

    it('renders empty state message when history is empty', async () => {
        useHistoryMock.mockReturnValue({
            data: { history: [], total: 0 },
            isLoading: false,
            error: null
        })

        render(<RebalanceHistory portfolioId="p1" />)

        expect(await screen.findByText(/No rebalancing history yet/i)).toBeTruthy()
        expect(screen.getByText(/Portfolio rebalances will appear here when they occur/i)).toBeTruthy()
    })

    it('shows pagination controls only when total > limit', async () => {
        // limit is 10 in the component
        useHistoryMock.mockReturnValue({
            data: { history: Array(10).fill({ id: '1', trigger: 'Test' }), total: 10 },
            isLoading: false,
            error: null
        })

        const { rerender } = render(<RebalanceHistory portfolioId="p1" />)
        
        // Should not show pagination for 10 items (exactly 1 page)
        expect(screen.queryByRole('button', { name: /2/ })).toBeNull()

        // Mock 11 items
        useHistoryMock.mockReturnValue({
            data: { history: Array(10).fill({ id: '1', trigger: 'Test' }), total: 11 },
            isLoading: false,
            error: null
        })

        rerender(<RebalanceHistory portfolioId="p1" />)

        // Should show page 2 button
        expect(await screen.findByRole('button', { name: '2' })).toBeTruthy()
    })

    it('updates page when pagination buttons are clicked', async () => {
        useHistoryMock.mockReturnValue({
            data: { history: Array(10).fill({ id: '1', trigger: 'Test' }), total: 25 },
            isLoading: false,
            error: null
        })

        render(<RebalanceHistory portfolioId="p1" />)

        // Initial call should be for page 1
        expect(useHistoryMock).toHaveBeenCalledWith('p1', 1, 10)

        // Click page 2
        const page2Button = await screen.findByRole('button', { name: '2' })
        fireEvent.click(page2Button)

        // Should call with page 2
        expect(useHistoryMock).toHaveBeenCalledWith('p1', 2, 10)

        // Click next
        const nextButton = screen.getAllByRole('button').find(b => b.innerHTML.includes('rotate-180') === false && b.querySelector('svg'))
        if (nextButton) fireEvent.click(nextButton)
        
        // Should call with page 3 (if we were on page 2)
        // Wait, the previous click set it to 2. Next should set it to 3.
        expect(useHistoryMock).toHaveBeenCalledWith('p1', 3, 10)
    })
})
