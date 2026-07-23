import { describe, it, expect, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import DriftGauge from './DriftGauge'

describe('DriftGauge snapshot', () => {
  beforeEach(() => {
    cleanup()
  })

  it('renders drift within threshold', () => {
    const { container } = render(<DriftGauge asset={{ name: 'XLM', target: 50, current: 52.5, threshold: 5 }} />)
    expect(container).toMatchSnapshot()
  })

  it('renders drift approaching threshold', () => {
    const { container } = render(<DriftGauge asset={{ name: 'XLM', target: 50, current: 54.2, threshold: 5 }} />)
    expect(container).toMatchSnapshot()
  })

  it('renders drift exceeding threshold', () => {
    const { container } = render(<DriftGauge asset={{ name: 'XLM', target: 50, current: 56.8, threshold: 5 }} />)
    expect(container).toMatchSnapshot()
  })

  it('renders with custom label', () => {
    const { container } = render(
      <DriftGauge asset={{ name: 'Max Drift', target: 50, current: 51.2, threshold: 5 }} />
    )
    expect(container).toMatchSnapshot()
  })

  it('renders zero drift', () => {
    const { container } = render(<DriftGauge asset={{ name: 'XLM', target: 50, current: 50, threshold: 5 }} />)
    expect(container).toMatchSnapshot()
  })

  it('renders negative drift', () => {
    const { container } = render(<DriftGauge asset={{ name: 'XLM', target: 50, current: 46.5, threshold: 5 }} />)
    expect(container).toMatchSnapshot()
  })
})
