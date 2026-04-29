import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import AssetCard from './AssetCard'

const mockAsset = {
    name: 'Bitcoin',
    value: 50,
    amount: 50000,
    color: '#F7931A'
}

describe('AssetCard', () => {
    afterEach(() => {
        cleanup()
    })

    describe('Price formatting', () => {
        it('formats $0.00 correctly', () => {
            render(<AssetCard asset={mockAsset} price={{ price: 0, change: 5 }} />)
            expect(screen.getByTestId('price-value')).toHaveTextContent('$0.00')
        })

        it('formats $1,234.56 correctly', () => {
            render(<AssetCard asset={mockAsset} price={{ price: 1234.56, change: 5 }} />)
            expect(screen.getByTestId('price-value')).toHaveTextContent('$1,234.56')
        })

        it('formats $0.001 to $0.00 correctly', () => {
            render(<AssetCard asset={mockAsset} price={{ price: 0.001, change: 5 }} />)
            expect(screen.getByTestId('price-value')).toHaveTextContent('$0.00')
        })
    })

    describe('Drift indicator', () => {
        it('shows green for positive drift', () => {
            const { container } = render(<AssetCard asset={mockAsset} price={{ price: 100, change: 5.25 }} />)
            const driftContainer = container.querySelector('.text-green-500')
            expect(driftContainer).toBeInTheDocument()
            expect(screen.getByTestId('trend-up')).toBeInTheDocument()
            expect(screen.getByTestId('drift-value')).toHaveTextContent('+5.25%')
        })

        it('shows red for negative drift', () => {
            const { container } = render(<AssetCard asset={mockAsset} price={{ price: 100, change: -3.14 }} />)
            const driftContainer = container.querySelector('.text-red-500')
            expect(driftContainer).toBeInTheDocument()
            expect(screen.getByTestId('trend-down')).toBeInTheDocument()
            expect(screen.getByTestId('drift-value')).toHaveTextContent('-3.14%')
        })

        it('shows neutral state for 0% drift', () => {
            const { container } = render(<AssetCard asset={mockAsset} price={{ price: 100, change: 0 }} />)
            const driftContainer = container.querySelector('.text-gray-500')
            expect(driftContainer).toBeInTheDocument()
            expect(screen.getByTestId('trend-neutral')).toBeInTheDocument()
            expect(screen.getByTestId('drift-value')).toHaveTextContent('0.00%')
        })
    })

    describe('Null/undefined price behavior', () => {
        it('gracefully renders a fallback text when price is null', () => {
            render(<AssetCard asset={mockAsset} price={{ price: null, change: null }} />)
            expect(screen.getByTestId('price-value')).toHaveTextContent('N/A')
            expect(screen.getByTestId('drift-value')).toHaveTextContent('N/A')
        })

        it('gracefully renders a fallback text when price object is undefined', () => {
            render(<AssetCard asset={mockAsset} price={undefined} />)
            expect(screen.getByTestId('price-value')).toHaveTextContent('N/A')
            expect(screen.getByTestId('drift-value')).toHaveTextContent('N/A')
        })
    })
})
