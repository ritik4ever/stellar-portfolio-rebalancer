import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { usePortfolio } from './usePortfolio'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('../config/api', async () => {
    const actual = await vi.importActual<typeof import('../config/api')>('../config/api')
    return {
        ...actual,
        api: {
            ...actual.api,
            get: getMock,
            post: postMock
        }
    }
})

function TestComponent({ portfolioId }: { portfolioId: string }) {
    const { portfolio, loading, error, executeRebalance } = usePortfolio(portfolioId)
    return (
        <div>
            <div data-testid="loading">{String(loading)}</div>
            <div data-testid="error">{error ?? ''}</div>
            <div data-testid="portfolio">{portfolio?.id ?? ''}</div>
            <button onClick={executeRebalance}>rebalance</button>
        </div>
    )
}

describe('usePortfolio', () => {
    beforeEach(() => {
        getMock.mockReset()
        postMock.mockReset()
    })

    it('loads portfolio data', async () => {
        getMock.mockResolvedValue({ portfolio: { id: 'p1', totalValue: 100, allocations: [], needsRebalance: false, lastRebalance: '' } })

        render(<TestComponent portfolioId="p1" />)

        await waitFor(() => expect(screen.getByTestId('portfolio').textContent).toBe('p1'))
        expect(screen.getByTestId('loading').textContent).toBe('false')
        expect(screen.getByTestId('error').textContent).toBe('')
    })

    it('executes rebalance and refreshes portfolio', async () => {
        getMock
            .mockResolvedValueOnce({ portfolio: { id: 'p1', totalValue: 100, allocations: [], needsRebalance: true, lastRebalance: '' } })
            .mockResolvedValueOnce({ portfolio: { id: 'p1', totalValue: 120, allocations: [], needsRebalance: false, lastRebalance: '' } })
        postMock.mockResolvedValue({ status: 'ok' })

        render(<TestComponent portfolioId="p1" />)
        await waitFor(() => expect(screen.getByTestId('portfolio').textContent).toBe('p1'))

        fireEvent.click(screen.getByRole('button', { name: 'rebalance' }))

        await waitFor(() => expect(postMock).toHaveBeenCalled())
        expect(getMock).toHaveBeenCalledTimes(2)
    })
})
