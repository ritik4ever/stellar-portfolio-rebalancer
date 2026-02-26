import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useReflector } from './useReflector'

const getMock = vi.fn()

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
        getMock.mockReset()
    })

    it('loads prices', async () => {
        getMock.mockResolvedValue({ XLM: { price: 0.1, change: 1, timestamp: 1 } })

        render(<TestComponent />)

        await waitFor(() => expect(screen.getByTestId('price').textContent).toBe('0.1'))
        expect(screen.getByTestId('loading').textContent).toBe('false')
        expect(screen.getByTestId('error').textContent).toBe('')
    })

    it('sets error when fetch fails', async () => {
        getMock.mockRejectedValue(new Error('fetch failed'))

        render(<TestComponent />)

        await waitFor(() => expect(screen.getByTestId('error').textContent).toContain('fetch failed'))
        expect(screen.getByTestId('loading').textContent).toBe('false')
    })
})
