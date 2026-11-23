import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import HistoricalSimulator from './HistoricalSimulator'
import { ApiClientError, api } from '../config/api'

const NOW = new Date('2028-03-05T12:00:00.000Z')

const completed = (overrides: Record<string, unknown> = {}) => ({
    startDate: '2028-02-27',
    endDate: '2028-03-04',
    finalValue: 10500,
    totalReturnPct: 5,
    buyAndHoldReturnPct: 3,
    rebalanceCount: 1,
    maxDrawdownPct: 2,
    absentDays: [],
    decision: { totalWindowDays: 7, includedDaysCount: 7, hasLeapDay: true, leapDayIncluded: true },
    dataSource: 'coingecko_market_chart',
    disclaimer: 'Historical simulation only.',
    ...overrides,
})

const selectSevenDays = () => fireEvent.click(screen.getByRole('button', { name: 'Use the last 7 closed days' }))
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))

describe('HistoricalSimulator', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    })

    afterEach(() => {
        cleanup()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('states the exact limits and the leap day for a seven-day window', () => {
        render(<HistoricalSimulator portfolioId="p1" />)
        selectSevenDays()

        expect(screen.getByText(/Allowed: 7 to 364 days, from 2027-03-07 through 2028-03-04/)).toBeTruthy()
        expect(screen.getByText('Selected: 7 days.')).toBeTruthy()
        expect(screen.getByText(/Includes leap day 2028-02-29/)).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Use the last 7 closed days' }).getAttribute('aria-pressed')).toBe('true')
    })

    it('blocks a six-day range, links the error, and focuses the field', () => {
        const post = vi.spyOn(api, 'post')
        render(<HistoricalSimulator portfolioId="p1" />)
        selectSevenDays()
        const start = screen.getByLabelText('Start date')
        fireEvent.change(start, { target: { value: '2028-02-28' } })
        submit()

        expect(post).not.toHaveBeenCalled()
        expect(start.getAttribute('aria-invalid')).toBe('true')
        const error = screen.getByText('Choose at least 7 days. This range has 6.')
        expect(start.getAttribute('aria-describedby')).toContain(error.id)
        expect(document.activeElement).toBe(start)
    })

    it('sends the chosen range and shows the requested range with its data source', async () => {
        const post = vi.spyOn(api, 'post').mockResolvedValue(completed())
        render(<HistoricalSimulator portfolioId="p1" />)
        selectSevenDays()
        submit()

        const heading = await screen.findByRole('heading', { name: 'Simulation result' })
        expect(post).toHaveBeenCalledWith(expect.stringContaining('/backtest'), {
            portfolioId: 'p1',
            days: 7,
            from: '2028-02-27T00:00:00.000Z',
            to: '2028-03-04T23:59:59.999Z',
        })
        expect(screen.getAllByText('2028-02-27 to 2028-03-04 (7 days)')).toHaveLength(2)
        expect(screen.getByText('CoinGecko daily closes')).toBeTruthy()
        expect(screen.getByText('Leap day (Feb 29) was included in this simulation.')).toBeTruthy()
        expect(screen.getByRole('status').textContent).toBe('Simulation complete. Evaluated 7 of 7 requested days.')
        await waitFor(() => expect(document.activeElement).toBe(heading))
    })

    it('reports a skipped leap day and partial coverage', async () => {
        vi.spyOn(api, 'post').mockResolvedValue(completed({
            absentDays: [{ date: '2028-02-29', reason: 'Leap day price feed unavailable for asset(s): XLM' }],
            decision: { totalWindowDays: 7, includedDaysCount: 6, hasLeapDay: true, leapDayIncluded: false },
        }))
        render(<HistoricalSimulator portfolioId="p1" />)
        selectSevenDays()
        submit()

        expect(await screen.findByText('Only 6 of 7 requested days had real prices for every asset.')).toBeTruthy()
        expect(screen.getByText('Leap day (Feb 29) was skipped because a closing price was missing.')).toBeTruthy()
        expect(screen.getByText(/2028-02-29: Leap day price feed unavailable/)).toBeTruthy()
    })

    it('announces insufficient real price history, focuses it, and can be dismissed', async () => {
        vi.spyOn(api, 'post').mockRejectedValue(new ApiClientError(
            'Not enough overlapping price history across the selected assets',
            503,
            'HISTORICAL_DATA_UNAVAILABLE',
        ))
        render(<HistoricalSimulator portfolioId="p1" />)
        selectSevenDays()
        submit()

        const alert = await screen.findByRole('alert')
        expect(alert.textContent).toContain('Not enough real price history')
        await waitFor(() => expect(document.activeElement).toBe(alert))
        expect(screen.getByRole('button', { name: 'Retry simulation' })).toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
        expect(screen.queryByRole('alert')).toBeNull()
        await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Run simulation' })))
    })

    it('lets a keyboard user abandon a run with Escape and ignores the late response', async () => {
        let resolve!: (value: unknown) => void
        vi.spyOn(api, 'post').mockReturnValue(new Promise((done) => { resolve = done }))
        render(<HistoricalSimulator portfolioId="p1" />)
        selectSevenDays()
        submit()

        const cancel = await screen.findByRole('button', { name: 'Cancel' })
        await waitFor(() => expect(document.activeElement).toBe(cancel))
        expect((screen.getByLabelText('Start date') as HTMLInputElement).disabled).toBe(true)

        fireEvent.keyDown(cancel, { key: 'Escape' })
        const run = await screen.findByRole('button', { name: 'Run simulation' })
        await waitFor(() => expect(document.activeElement).toBe(run))
        expect(screen.getByRole('status').textContent).toBe('Simulation cancelled. No result is shown.')

        await act(async () => { resolve(completed()) })
        expect(screen.queryByRole('heading', { name: 'Simulation result' })).toBeNull()
    })

    it('clears a result when the range changes so it cannot describe another range', async () => {
        vi.spyOn(api, 'post').mockResolvedValue(completed())
        render(<HistoricalSimulator portfolioId="p1" />)
        selectSevenDays()
        submit()
        await screen.findByRole('heading', { name: 'Simulation result' })

        fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2028-02-20' } })

        expect(screen.queryByRole('heading', { name: 'Simulation result' })).toBeNull()
        expect(screen.getByRole('status').textContent).toBe('Range changed. The previous simulation result was cleared.')
    })

    it('keeps narrow-layout guards on the controls', () => {
        render(<HistoricalSimulator portfolioId="p1" />)
        const start = screen.getByLabelText('Start date')
        expect(start.className).toContain('w-full')
        expect(start.className).toContain('min-w-0')
        expect(screen.getByRole('group', { name: 'Quick ranges' }).className).toContain('flex-wrap')
    })
})
