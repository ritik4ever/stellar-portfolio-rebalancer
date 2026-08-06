import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import TaxReportPage from '../TaxReport'

const mockUseTaxReportQuery = vi.hoisted(() => vi.fn())
const mockDownloadCSV = vi.hoisted(() => vi.fn())
const mockDownloadJSON = vi.hoisted(() => vi.fn())
const mockToCSV = vi.hoisted(() => vi.fn(() => 'asset,date\nXLM,2025-01-01\n'))
const mockRunExportWithProgress = vi.hoisted(() =>
    vi.fn(async (_labels: unknown, _onProgress: unknown, run: () => Promise<void>) => {
        await run()
    }),
)

vi.mock('../../hooks/queries/useTaxReportQuery', () => ({
    useTaxReportQuery: mockUseTaxReportQuery,
}))

vi.mock('../../utils/export', () => ({
    downloadCSV: mockDownloadCSV,
    downloadJSON: mockDownloadJSON,
    toCSV: mockToCSV,
    runExportWithProgress: mockRunExportWithProgress,
    idleExportProgress: () => ({ phase: 'idle', label: '' }),
}))

const mockReport = {
    taxYear: 2025,
    totalRealizedGainLoss: 250.5,
    totalTrades: 2,
    methodology: 'FIFO (first-in, first-out). Each rebalance buys one asset and sells another.',
    entries: [
        {
            asset: 'XLM',
            date: '2025-03-01T00:00:00Z',
            type: 'sell',
            amount: 1000,
            price: 0.5,
            costBasis: 400,
            realizedGainLoss: 100,
        },
        {
            asset: 'USDC',
            date: '2025-03-01T00:00:00Z',
            type: 'buy',
            amount: 500,
            price: 1,
            costBasis: 500,
            realizedGainLoss: 0,
        },
    ],
}

describe('TaxReportPage', () => {
    const onNavigate = vi.fn()

    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        mockUseTaxReportQuery.mockReturnValue({ data: mockReport, isLoading: false, isError: false })
    })

    it('requires a connected wallet', () => {
        render(<TaxReportPage onNavigate={onNavigate} publicKey={null} />)
        expect(screen.getByText('Connect a wallet to view your tax report')).toBeTruthy()
        expect(screen.getByText('Connect Wallet')).toBeTruthy()
    })

    it('renders the report summary and entries table', () => {
        render(<TaxReportPage onNavigate={onNavigate} publicKey={'GA-test-key'} />)

        expect(screen.getByText('Tax Report')).toBeTruthy()
        expect(screen.getByText('Total realized gain')).toBeTruthy()
        expect(screen.getByText('$250.50')).toBeTruthy()
        expect(screen.getByText('Total trades')).toBeTruthy()
        expect(screen.getByText('2')).toBeTruthy()
        expect(screen.getByText('XLM')).toBeTruthy()
        expect(screen.getByText('USDC')).toBeTruthy()
        expect(screen.getByText('sell')).toBeTruthy()
        expect(screen.getByText('buy')).toBeTruthy()
    })

    it('queries with the selected year', () => {
        render(<TaxReportPage onNavigate={onNavigate} publicKey={'GA-test-key'} />)

        const select = screen.getByRole('combobox')
        fireEvent.change(select, { target: { value: '2024' } })

        expect(mockUseTaxReportQuery).toHaveBeenLastCalledWith(2024)
    })

    it('exports CSV from the report entries', async () => {
        render(<TaxReportPage onNavigate={onNavigate} publicKey={'GA-test-key'} />)

        fireEvent.change(screen.getByRole('combobox'), { target: { value: '2025' } })
        const csvButton = screen.getByRole('button', { name: 'CSV' })
        await act(async () => {
            fireEvent.click(csvButton)
        })

        expect(mockDownloadCSV).toHaveBeenCalledWith(
            'tax-report-2025.csv',
            expect.any(String),
        )
    })

    it('exports JSON of the full report', async () => {
        render(<TaxReportPage onNavigate={onNavigate} publicKey={'GA-test-key'} />)

        fireEvent.change(screen.getByRole('combobox'), { target: { value: '2025' } })
        const jsonButton = screen.getByRole('button', { name: 'JSON' })
        await act(async () => {
            fireEvent.click(jsonButton)
        })

        expect(mockDownloadJSON).toHaveBeenCalledWith('tax-report-2025.json', mockReport)
    })

    it('shows an empty state when no trades are recorded', () => {
        mockUseTaxReportQuery.mockReturnValue({
            data: { ...mockReport, totalTrades: 0, entries: [] },
            isLoading: false,
            isError: false,
        })

        render(<TaxReportPage onNavigate={onNavigate} publicKey={'GA-test-key'} />)

        fireEvent.change(screen.getByRole('combobox'), { target: { value: '2025' } })

        expect(screen.getByText(/No trades recorded in 2025/)).toBeTruthy()
    })
})
