import React from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CorrelationHeatmap, { correlationColor } from './CorrelationHeatmap'

const assets = ['XLM', 'BTC', 'ETH']

const matrices = {
  '7D': [
    [1, -0.25, 0.4],
    [-0.25, 1, 0.75],
    [0.4, 0.75, 1],
  ],
  '30D': [
    [1, -0.5, 0],
    [-0.5, 1, 0.8],
    [0, 0.8, 1],
  ],
  '90D': [
    [1, -0.9, 0.2],
    [-0.9, 1, 0.3],
    [0.2, 0.3, 1],
  ],
}

describe('CorrelationHeatmap', () => {
  it('renders diagonal cells as 1.0', () => {
    render(<CorrelationHeatmap assets={assets} correlations={matrices} />)

    expect(screen.getByTestId('correlation-cell-0-0')).toHaveTextContent('1.0')
    expect(screen.getByTestId('correlation-cell-1-1')).toHaveTextContent('1.0')
    expect(screen.getByTestId('correlation-cell-2-2')).toHaveTextContent('1.0')
  })

  it('uses red, white, and green color anchors', () => {
    expect(correlationColor(-1)).toBe('rgb(255, 0, 0)')
    expect(correlationColor(0)).toBe('rgb(255, 255, 255)')
    expect(correlationColor(1)).toBe('rgb(0, 255, 0)')
  })

  it('shows exact coefficient and pair names in the tooltip', async () => {
    render(<CorrelationHeatmap assets={assets} correlations={matrices} />)

    fireEvent.mouseEnter(screen.getByTestId('correlation-cell-0-1'))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('XLM / BTC: -0.50')
  })

  it('switches matrices when the time range changes', () => {
    render(<CorrelationHeatmap assets={assets} correlations={matrices} />)

    expect(screen.getByTestId('correlation-cell-0-1')).toHaveTextContent('-0.50')

    fireEvent.click(screen.getByRole('button', { name: '7D' }))
    expect(screen.getByTestId('correlation-cell-0-1')).toHaveTextContent('-0.25')

    fireEvent.click(screen.getByRole('button', { name: '90D' }))
    expect(screen.getByTestId('correlation-cell-0-1')).toHaveTextContent('-0.90')
  })

  it('renders no more than a 10 by 10 matrix', () => {
    const manyAssets = Array.from({ length: 12 }, (_, index) => `A${index + 1}`)
    const matrix = manyAssets.map((_, rowIndex) =>
      manyAssets.map((__, columnIndex) => (rowIndex === columnIndex ? 1 : 0.1)),
    )

    render(<CorrelationHeatmap assets={manyAssets} correlations={{ '30D': matrix }} />)

    expect(screen.getAllByRole('gridcell')).toHaveLength(100)
    expect(screen.queryByText('A11')).not.toBeInTheDocument()
  })
})
