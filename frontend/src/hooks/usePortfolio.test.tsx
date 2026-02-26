import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { usePortfolio } from './usePortfolio'
import { api } from '../config/api'

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
        cleanup()
        vi.restoreAllMocks()
    })

    it('loads portfolio data', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({
            portfolio: { id: 'p1', totalValue: 100, allocations: [], needsRebalance: false, lastRebalance: '' }
        } as any)

        render(<TestComponent portfolioId="p1" />)

        await waitFor(() => expect(screen.getByTestId('portfolio').textContent).toBe('p1'))
        expect(screen.getByTestId('loading').textContent).toBe('false')
        expect(screen.getByTestId('error').textContent).toBe('')
    })

    it('executes rebalance and refreshes portfolio', async () => {
        const getSpy = vi.spyOn(api, 'get')
            .mockResolvedValueOnce({ portfolio: { id: 'p1', totalValue: 100, allocations: [], needsRebalance: true, lastRebalance: '' } } as any)
            .mockResolvedValueOnce({ portfolio: { id: 'p1', totalValue: 120, allocations: [], needsRebalance: false, lastRebalance: '' } } as any)
        const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ status: 'ok' } as any)

        render(<TestComponent portfolioId="p1" />)
        await waitFor(() => expect(screen.getByTestId('portfolio').textContent).toBe('p1'))

        fireEvent.click(screen.getByRole('button', { name: 'rebalance' }))

        await waitFor(() => expect(postSpy).toHaveBeenCalled())
        expect(getSpy).toHaveBeenCalledTimes(2)
    })
})
