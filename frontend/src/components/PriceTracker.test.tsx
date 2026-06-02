import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import PriceTracker from './PriceTracker'

const mocks = vi.hoisted(() => ({
    usePrices: vi.fn(),
    useAssets: vi.fn(),
    useRealtimeConnection: vi.fn(),
}))

vi.mock('../hooks/queries/usePricesQuery', () => ({ usePrices: mocks.usePrices }))
vi.mock('../hooks/queries/useAssetsQuery', () => ({ useAssets: mocks.useAssets }))
vi.mock('../context/RealtimeConnectionContext', () => ({
    useRealtimeConnection: mocks.useRealtimeConnection,
}))

const PRICES = {
    XLM: { price: 0.12, change: 5.0, source: 'coingecko', timestamp: 1700000000 },
    BTC: { price: 60000, change: -2.0, source: 'reflector', timestamp: 1700000000 },
    ETH: { price: 3000, change: 1.5, source: 'coingecko', timestamp: 1700000000 },
    USDC: { price: 1.0, change: 0.0, source: 'coingecko', timestamp: 1700000000 },
}

function setup(overrides: Partial<typeof mocks> = {}) {
    mocks.usePrices.mockReturnValue({
        data: { prices: PRICES, feedMeta: undefined },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
    })
    mocks.useAssets.mockReturnValue({ data: ['XLM', 'BTC', 'ETH', 'USDC'] })
    mocks.useRealtimeConnection.mockReturnValue({ state: 'connected' })
    Object.assign(mocks, overrides)
}

beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('PriceTracker – normal mode', () => {
    it('renders price cards for all assets', () => {
        setup()
        render(<PriceTracker />)
        expect(screen.getByText('XLM')).toBeTruthy()
        expect(screen.getByText('BTC')).toBeTruthy()
    })

    it('shows loading skeleton when no prices yet', () => {
        setup()
        mocks.usePrices.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() })
        render(<PriceTracker />)
        expect(screen.queryByText('XLM')).toBeNull()
    })

    it('shows error message with retry', () => {
        setup()
        mocks.usePrices.mockReturnValue({
            data: { prices: PRICES },
            isLoading: false,
            error: new Error('fetch failed'),
            refetch: vi.fn(),
        })
        render(<PriceTracker />)
        expect(screen.getByText(/fetch failed/i)).toBeTruthy()
    })

    it('renders compact mode without compare button', () => {
        setup()
        render(<PriceTracker compact />)
        expect(screen.queryByRole('button', { name: /compare/i })).toBeNull()
    })
})

describe('PriceTracker – compare mode', () => {
    it('shows Compare button in full mode', () => {
        setup()
        render(<PriceTracker />)
        expect(screen.getByRole('button', { name: /compare/i })).toBeTruthy()
    })

    it('toggles compare panel on button click', () => {
        setup()
        render(<PriceTracker />)
        expect(screen.queryByRole('region', { name: /asset comparison/i })).toBeNull()

        fireEvent.click(screen.getByRole('button', { name: /compare/i }))
        expect(screen.getByRole('region', { name: /asset comparison/i })).toBeTruthy()

        fireEvent.click(screen.getByRole('button', { name: /compare/i }))
        expect(screen.queryByRole('region', { name: /asset comparison/i })).toBeNull()
    })

    it('shows relative movement summary when two different assets selected', () => {
        setup()
        render(<PriceTracker />)
        fireEvent.click(screen.getByRole('button', { name: /compare/i }))

        // XLM change=5, BTC change=-2 → XLM outperforms by 7pp
        const selectA = screen.getByRole('combobox', { name: /asset a/i })
        const selectB = screen.getByRole('combobox', { name: /asset b/i })
        fireEvent.change(selectA, { target: { value: 'XLM' } })
        fireEvent.change(selectB, { target: { value: 'BTC' } })

        expect(screen.getByText(/outperformed/i)).toBeTruthy()
        expect(screen.getByText(/7\.00 pp/i)).toBeTruthy()
    })

    it('shows warning when same asset selected for both', () => {
        setup()
        render(<PriceTracker />)
        fireEvent.click(screen.getByRole('button', { name: /compare/i }))

        const selectA = screen.getByRole('combobox', { name: /asset a/i })
        const selectB = screen.getByRole('combobox', { name: /asset b/i })
        fireEvent.change(selectA, { target: { value: 'XLM' } })
        fireEvent.change(selectB, { target: { value: 'XLM' } })

        expect(screen.getByText(/select two different assets/i)).toBeTruthy()
    })

    it('shows waiting message when price data is missing', () => {
        setup()
        mocks.usePrices.mockReturnValue({
            data: { prices: {}, feedMeta: undefined },
            isLoading: false,
            error: null,
            refetch: vi.fn(),
        })
        render(<PriceTracker />)
        fireEvent.click(screen.getByRole('button', { name: /compare/i }))
        expect(screen.getByText(/waiting for price data/i)).toBeTruthy()
    })
})
