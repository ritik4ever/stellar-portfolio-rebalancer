/**
 * SPR-2026-054 (#1978): Rebalance history must stay usable at a 320px
 * viewport and with 200% text sizing.
 *
 * jsdom has no layout engine, so the suite asserts the structural contract the
 * layout relies on (wrapping containers, shrinkable children, windowed
 * pagination) and drives every control while the root font size is doubled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import RebalanceHistory from './RebalanceHistory'

const { useHistoryMock, downloadCsvMock, toCsvMock } = vi.hoisted(() => ({
    useHistoryMock: vi.fn(),
    downloadCsvMock: vi.fn(),
    toCsvMock: vi.fn(() => 'csv-content'),
}))

vi.mock('../hooks/queries/useHistoryQuery', () => ({
    useRebalanceHistory: useHistoryMock,
}))

vi.mock('../utils/export', () => ({
    downloadCSV: downloadCsvMock,
    toCSV: toCsvMock,
}))

const TIMESTAMP = '2026-01-01T10:00:00.000Z'

const makeEvents = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
        id: `e-${index}`,
        timestamp: TIMESTAMP,
        trigger:
            index === 0
                ? 'Automatic rebalancing triggered by a drift of 12.75% across four assets'
                : 'Scheduled rebalance',
        trades: index === 0 ? 3 : 1,
        gasUsed: '0.0234 XLM',
        status: 'completed' as const,
        portfolioId: 'p1',
        details: { amount: index === 0 ? 1200 : 800, fromAsset: 'XLM', toAsset: 'USDC' },
    }))

function mockHistory(total: number, history = makeEvents(10)) {
    useHistoryMock.mockReturnValue({
        data: { history, total },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
    })
}

describe('RebalanceHistory narrow layout (SPR-2026-054)', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        downloadCsvMock.mockReset()
        toCsvMock.mockClear()
    })

    afterEach(() => {
        document.documentElement.style.fontSize = ''
    })

    it('wraps controls and event rows instead of clipping, keeping order and trade amounts', () => {
        mockHistory(25)
        render(<RebalanceHistory portfolioId="p1" />)

        const controls = screen.getByTestId('rebalance-history-controls')
        expect(controls.className).toMatch(/\bflex-wrap\b/)
        expect(controls.className).toMatch(/\bmin-w-0\b/)

        const section = screen.getByTestId('rebalance-history')
        expect(section.className).toMatch(/\bmin-w-0\b/)
        expect(section.className).toMatch(/\bmax-w-full\b/)

        const events = screen.getAllByTestId('rebalance-history-event')
        expect(events).toHaveLength(10)
        events.forEach((event) => {
            expect(event.className).toMatch(/\bmin-w-0\b/)
        })

        // Same-timestamp events keep the API order that the a11y/edge suites pin.
        const triggers = screen.getAllByText(/Automatic rebalancing triggered|Scheduled rebalance/)
        expect(
            triggers[0].compareDocumentPosition(triggers[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()

        // Trade amounts stay rendered and wrappable rather than ellipsized or
        // pushed out of the row.
        expect(screen.getAllByText(/Amount: \$1,200/)).toHaveLength(1)
        expect(screen.getAllByText(/Amount: \$800/)).toHaveLength(9)
        expect(screen.getByText(/3 trades/)).toBeTruthy()
    })

    it('keeps export and pagination operable with 200% text sizing', async () => {
        document.documentElement.style.fontSize = '200%'
        mockHistory(100)

        render(<RebalanceHistory portfolioId="p1" />)

        fireEvent.click(screen.getByRole('button', { name: /Export CSV/i }))
        expect(toCsvMock).toHaveBeenCalledTimes(1)
        expect(downloadCsvMock).toHaveBeenCalledTimes(1)

        const next = screen.getByRole('button', { name: 'Next page' })
        fireEvent.click(next)

        expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'page')
        expect(screen.getByText('Showing rebalance history page 2 of 10.')).toBeTruthy()
        expect(screen.getByRole('navigation', { name: 'Rebalance history pagination' })).toBeTruthy()
    })

    it('renders a page window instead of every page button', () => {
        mockHistory(100)
        render(<RebalanceHistory portfolioId="p1" />)

        const numbered = screen
            .getAllByRole('button')
            .filter((button) => /^\d+$/.test(button.textContent ?? ''))

        // 10 pages, but only first/last plus the current neighbourhood are shown.
        expect(numbered.length).toBeLessThanOrEqual(5)
        expect(screen.getByRole('button', { name: '1' })).toBeTruthy()
        expect(screen.getByRole('button', { name: '10' })).toBeTruthy()
        expect(screen.queryByRole('button', { name: '5' })).toBeNull()
        expect(document.body.textContent).toContain('…')
    })
})
