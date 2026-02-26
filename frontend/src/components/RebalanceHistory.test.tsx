import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RebalanceHistory from './RebalanceHistory'

const getMock = vi.fn()
const downloadCsvMock = vi.fn()
const toCsvMock = vi.fn(() => 'csv-content')

vi.mock('../config/api', async () => {
    const actual = await vi.importActual<typeof import('../config/api')>('../config/api')
    return {
        ...actual,
        api: {
            ...actual.api,
            get: getMock
        }
    }
})

vi.mock('../utils/export', () => ({
    downloadCSV: downloadCsvMock,
    toCSV: toCsvMock
}))

describe('RebalanceHistory', () => {
    beforeEach(() => {
        getMock.mockReset()
        downloadCsvMock.mockReset()
        toCsvMock.mockClear()
    })

    it('renders fetched history data', async () => {
        getMock.mockResolvedValue({
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
        })

        render(<RebalanceHistory portfolioId="p1" />)

        expect(await screen.findByText('Automatic Rebalancing')).toBeInTheDocument()
        expect(screen.getByText(/2 trades/i)).toBeInTheDocument()
    })

    it('falls back to demo history and shows load error when API fails', async () => {
        getMock.mockRejectedValue(new Error('boom'))

        render(<RebalanceHistory portfolioId="p1" />)

        expect(await screen.findByText(/Failed to load rebalance history/i)).toBeInTheDocument()
        expect(await screen.findByText(/Threshold exceeded/i)).toBeInTheDocument()
    })

    it('exports CSV when export button is clicked', async () => {
        getMock.mockResolvedValue({
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
        })

        render(<RebalanceHistory portfolioId="p1" />)

        const button = await screen.findByRole('button', { name: /Export CSV/i })
        fireEvent.click(button)

        expect(toCsvMock).toHaveBeenCalled()
        expect(downloadCsvMock).toHaveBeenCalledWith(expect.stringMatching(/^rebalance_history_p1_/), 'csv-content')
    })
})
