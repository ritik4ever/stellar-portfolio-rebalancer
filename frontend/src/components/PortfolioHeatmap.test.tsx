import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import PortfolioHeatmap, { heatmapTileColor, type HeatmapAsset } from './PortfolioHeatmap'

const sampleAssets: HeatmapAsset[] = [
  { name: 'XLM', allocation: 40, change: 2.5, color: '#3B82F6' },
  { name: 'USDC', allocation: 30, change: 0, color: '#10B981' },
  { name: 'BTC', allocation: 20, change: -3.75, color: '#F59E0B' },
  { name: 'ETH', allocation: 10, change: 1.1, color: '#8B5CF6' },
]

afterEach(cleanup)

describe('heatmapTileColor', () => {
  it('returns a neutral gray for zero change', () => {
    expect(heatmapTileColor(0)).toBe('rgb(229, 231, 235)')
  })

  it('maps positive change to a green scale', () => {
    const positive = heatmapTileColor(10)
    expect(positive).toMatch(/^rgb\(\d+, 255, \d+\)$/)
  })

  it('maps negative change to a red scale', () => {
    const negative = heatmapTileColor(-10)
    expect(negative).toMatch(/^rgb\(255, \d+, \d+\)$/)
  })

  it('treats non-finite input as neutral', () => {
    expect(heatmapTileColor(Number.NaN)).toBe('rgb(229, 231, 235)')
  })
})

describe('PortfolioHeatmap', () => {
  it('renders one tile per asset with allocation and change text', () => {
    render(<PortfolioHeatmap assets={sampleAssets} />)

    const grid = screen.getByTestId('portfolio-heatmap-grid')
    const tiles = within(grid).getAllByRole('gridcell')
    expect(tiles).toHaveLength(sampleAssets.length)

    const xlmTile = screen.getByTestId('portfolio-heatmap-tile-XLM')
    expect(xlmTile).toHaveTextContent('XLM')
    expect(xlmTile).toHaveTextContent('40%')
    expect(xlmTile).toHaveTextContent('+2.50%')
  })

  it('supplements color with an accessible label so meaning does not rely on color alone', () => {
    render(<PortfolioHeatmap assets={sampleAssets} />)

    expect(
      screen.getByRole('gridcell', {
        name: 'BTC: 20% allocation, -3.75% 24h change',
      }),
    ).toBeInTheDocument()
  })

  it('sizes tiles proportionally to allocation via flexGrow', () => {
    render(<PortfolioHeatmap assets={sampleAssets} />)

    const xlm = screen.getByTestId('portfolio-heatmap-tile-XLM')
    const eth = screen.getByTestId('portfolio-heatmap-tile-ETH')

    const xlmGrow = Number.parseFloat(xlm.style.flexGrow)
    const ethGrow = Number.parseFloat(eth.style.flexGrow)

    expect(xlmGrow).toBeGreaterThan(ethGrow)
    expect(xlmGrow).toBe(40)
    expect(ethGrow).toBe(10)
  })

  it('opens a detail modal for the clicked asset', () => {
    render(<PortfolioHeatmap assets={sampleAssets} />)

    fireEvent.click(screen.getByTestId('portfolio-heatmap-tile-BTC'))

    expect(screen.getByRole('dialog', { name: /BTC detail/i })).toBeInTheDocument()
    const dialog = screen.getByRole('dialog', { name: /BTC detail/i })
    expect(within(dialog).getByText('20%')).toBeInTheDocument()
    expect(within(dialog).getByText('-3.75%')).toBeInTheDocument()
  })

  it('caps rendering at 10 assets', () => {
    const manyAssets: HeatmapAsset[] = Array.from({ length: 14 }, (_, index) => ({
      name: `A${index + 1}`,
      allocation: 5,
      change: index % 2 === 0 ? 1 : -1,
    }))

    render(<PortfolioHeatmap assets={manyAssets} />)

    expect(screen.getAllByRole('gridcell')).toHaveLength(10)
    expect(screen.queryByTestId('portfolio-heatmap-tile-A11')).not.toBeInTheDocument()
  })

  it('renders an empty state when no assets are provided', () => {
    render(<PortfolioHeatmap assets={[]} />)

    expect(screen.getByTestId('portfolio-heatmap-empty')).toBeInTheDocument()
    expect(screen.queryByRole('gridcell')).not.toBeInTheDocument()
  })

  it('skips assets with zero or negative allocation', () => {
    const mixed: HeatmapAsset[] = [
      { name: 'XLM', allocation: 50, change: 1 },
      { name: 'GHOST', allocation: 0, change: 5 },
      { name: 'USDC', allocation: 50, change: -1 },
    ]

    render(<PortfolioHeatmap assets={mixed} />)

    expect(screen.getAllByRole('gridcell')).toHaveLength(2)
    expect(screen.queryByTestId('portfolio-heatmap-tile-GHOST')).not.toBeInTheDocument()
  })
})
