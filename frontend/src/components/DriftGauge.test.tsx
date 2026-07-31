import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DriftGauge, DriftGaugeGrid, type DriftGaugeAsset } from './DriftGauge'

describe('DriftGauge', () => {
  beforeEach(() => {
    cleanup()
  })

  const baseAsset: DriftGaugeAsset = { name: 'XLM', target: 40, current: 42.5, threshold: 5 }

  it('renders the asset name and drift value', () => {
    const { container } = render(<DriftGauge asset={baseAsset} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('XLM'))
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('+2.5%'))
  })

  it('shows tooltip on hover', () => {
    render(<DriftGauge asset={baseAsset} />)
    const gauge = screen.getByRole('img')
    fireEvent.mouseEnter(gauge)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('XLM')
    expect(screen.getByRole('tooltip')).toHaveTextContent('42.50%')
    expect(screen.getByRole('tooltip')).toHaveTextContent('40.00%')
    expect(screen.getByRole('tooltip')).toHaveTextContent('+2.5%')
  })

  it('shows critical status when drift exceeds threshold', () => {
    const criticalAsset: DriftGaugeAsset = { name: 'ETH', target: 30, current: 38, threshold: 5 }
    render(<DriftGauge asset={criticalAsset} />)
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('Exceeds threshold'))
  })

  it('shows warning status when drift approaches threshold', () => {
    const warningAsset: DriftGaugeAsset = { name: 'BTC', target: 30, current: 33, threshold: 5 }
    render(<DriftGauge asset={warningAsset} />)
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('Approaching threshold'))
  })

  it('shows ok status when drift is within threshold', () => {
    const okAsset: DriftGaugeAsset = { name: 'USDC', target: 30, current: 31, threshold: 5 }
    render(<DriftGauge asset={okAsset} />)
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('Within target'))
  })

  it('renders with custom size', () => {
    const { container } = render(<DriftGauge asset={baseAsset} size={128} />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '128')
    expect(svg).toHaveAttribute('height', '128')
  })
})

describe('DriftGaugeGrid', () => {
  beforeEach(() => {
    cleanup()
  })

  const sampleAssets: DriftGaugeAsset[] = [
    { name: 'XLM', target: 40, current: 45, threshold: 5 },
    { name: 'BTC', target: 30, current: 27, threshold: 5 },
    { name: 'ETH', target: 20, current: 21, threshold: 5 },
    { name: 'USDC', target: 10, current: 7, threshold: 3 },
  ]

  it('renders all assets as individual gauges', () => {
    render(<DriftGaugeGrid assets={sampleAssets} />)
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('renders nothing for empty assets', () => {
    const { container } = render(<DriftGaugeGrid assets={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows per-asset breakdown tooltip on title hover sorted by largest drift first', () => {
    render(<DriftGaugeGrid assets={sampleAssets} />)

    const heading = screen.getByText('Allocation Drift')
    fireEvent.mouseEnter(heading)

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Drift Breakdown')

    const tooltipText = tooltip.textContent || ''
    const xlmIndex = tooltipText.indexOf('XLM')
    const btcIndex = tooltipText.indexOf('BTC')
    const ethIndex = tooltipText.indexOf('ETH')
    const usdcIndex = tooltipText.indexOf('USDC')

    expect(xlmIndex).toBeGreaterThan(-1)
    expect(btcIndex).toBeGreaterThan(-1)
    expect(ethIndex).toBeGreaterThan(-1)
    expect(usdcIndex).toBeGreaterThan(-1)

    expect(xlmIndex).toBeLessThan(btcIndex)
    expect(btcIndex).toBeLessThan(usdcIndex)
    expect(usdcIndex).toBeLessThan(ethIndex)

    expect(tooltip).toHaveTextContent(/Total absolute drift/)
    expect(tooltip.textContent).toContain('XLM')
    expect(tooltip.textContent).toContain('+5.0%')
  })

  it('renders custom title', () => {
    render(<DriftGaugeGrid assets={sampleAssets} title="Custom Title" />)
    expect(screen.getByText('Custom Title')).toBeInTheDocument()
  })
})
