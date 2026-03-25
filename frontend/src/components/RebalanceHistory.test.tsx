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

        expect(await screen.findByText('Automatic Rebalancing')).toBeInTheDocument()
        expect(screen.getByText(/2 trades/i)).toBeInTheDocument()
    })

    it('shows fallback error state', async () => {
        useHistoryMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') })

        render(<RebalanceHistory portfolioId="p1" />)

        expect(await screen.findByText(/Failed to load rebalance history/i)).toBeInTheDocument()
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
})
