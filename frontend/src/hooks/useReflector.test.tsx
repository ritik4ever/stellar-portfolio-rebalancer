import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { useReflector } from './useReflector'
import { api } from '../config/api'

function TestComponent() {
    const { prices, loading, error } = useReflector()
    return (
        <div>
            <div data-testid="loading">{String(loading)}</div>
            <div data-testid="error">{error ?? ''}</div>
            <div data-testid="price">{prices.XLM?.price ?? ''}</div>
        </div>
    )
}

describe('useReflector', () => {
    beforeEach(() => {
        cleanup()
        vi.restoreAllMocks()
    })

    it('loads prices', async () => {
        vi.spyOn(api, 'get').mockResolvedValue({ XLM: { price: 0.1, change: 1, timestamp: 1 } } as any)

        render(<TestComponent />)

        await waitFor(() => expect(screen.getByTestId('price').textContent).toBe('0.1'))
        expect(screen.getByTestId('loading').textContent).toBe('false')
        expect(screen.getByTestId('error').textContent).toBe('')
    })

    it('sets error when fetch fails', async () => {
        vi.spyOn(api, 'get').mockRejectedValue(new Error('fetch failed'))

        render(<TestComponent />)

        await waitFor(() => expect(screen.getByTestId('error').textContent).toContain('fetch failed'))
        expect(screen.getByTestId('loading').textContent).toBe('false')
    })
})
