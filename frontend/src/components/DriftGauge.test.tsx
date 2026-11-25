import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DriftGauge, DriftGaugeGrid, getDriftStatus, describeDriftStatus, type DriftGaugeAsset } from './DriftGauge'

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

  it('labels zero drift as on target without a sign', () => {
    const onTarget: DriftGaugeAsset = { name: 'XLM', target: 40, current: 40, threshold: 5 }
    render(<DriftGauge asset={onTarget} />)
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('drift 0.0%'))
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('on target'))
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('On target'))
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('Threshold: ±5%'))
  })

  it('labels negative movement as below target with a signed drift', () => {
    const below: DriftGaugeAsset = { name: 'BTC', target: 30, current: 27.5, threshold: 5 }
    render(<DriftGauge asset={below} />)
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('drift -2.5%'))
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('below target'))
    fireEvent.mouseEnter(svg)
    expect(screen.getByRole('tooltip')).toHaveTextContent('-2.5%')
  })

  it('treats a move exactly at the threshold as allowed, not exceeding', () => {
    const atThreshold: DriftGaugeAsset = { name: 'ETH', target: 30, current: 35, threshold: 5 }
    render(<DriftGauge asset={atThreshold} />)
    const svg = screen.getByRole('img')
    const label = svg.getAttribute('aria-label') ?? ''
    expect(label).toContain('At threshold')
    expect(label).not.toContain('Exceeds threshold')
    expect(getDriftStatus(5, 5)).toBe('at_threshold')
    expect(getDriftStatus(-5, 5)).toBe('at_threshold')
    expect(describeDriftStatus(5, 5)).toBe('At threshold')
  })

  it('marks drift beyond the threshold as exceeding it', () => {
    expect(getDriftStatus(5.01, 5)).toBe('critical')
    expect(getDriftStatus(-5.01, 5)).toBe('critical')
    expect(describeDriftStatus(8, 5)).toBe('Exceeds threshold')
  })

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])(
    'communicates the allowed threshold value when threshold %s is invalid',
    (threshold) => {
      const asset: DriftGaugeAsset = { name: 'XLM', target: 40, current: 60, threshold }
      render(<DriftGauge asset={asset} />)
      const svg = screen.getByRole('img')
      expect(svg).toHaveAttribute('aria-label', expect.stringContaining('No threshold set'))
      expect(svg).toHaveAttribute('aria-label', expect.stringContaining('greater than 0%'))
      fireEvent.mouseEnter(svg)
      expect(screen.getByRole('tooltip')).toHaveTextContent('Not set (must be > 0%)')
    }
  )

  it('shows the as-of timestamp alongside the drift so scale and time stay aligned', () => {
    const asOf = Date.parse('2026-01-01T12:00:00.000Z')
    const asset: DriftGaugeAsset = { name: 'XLM', target: 40, current: 42.5, threshold: 5, asOf }
    render(<DriftGauge asset={asset} />)
    const svg = screen.getByRole('img')
    expect(svg).toHaveAttribute('aria-label', expect.stringContaining('As of'))
    expect(screen.getByText(/as of /)).toBeInTheDocument()
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
