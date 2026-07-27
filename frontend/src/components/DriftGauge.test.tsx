import { describe, it, expect, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import DriftGauge from './DriftGauge'

describe('DriftGauge snapshot', () => {
  beforeEach(() => {
    cleanup()
  })

  it('renders drift within threshold', () => {
    const { container } = render(<DriftGauge drift={2.5} threshold={5} />)
    expect(container).toMatchSnapshot()
  })

  it('renders drift approaching threshold', () => {
    const { container } = render(<DriftGauge drift={4.2} threshold={5} />)
    expect(container).toMatchSnapshot()
  })

  it('renders drift exceeding threshold', () => {
    const { container } = render(<DriftGauge drift={6.8} threshold={5} />)
    expect(container).toMatchSnapshot()
  })

  it('renders with custom label', () => {
    const { container } = render(
      <DriftGauge drift={1.2} threshold={5} label="Max Drift" />
    )
    expect(container).toMatchSnapshot()
  })

  it('renders zero drift', () => {
    const { container } = render(<DriftGauge drift={0} threshold={5} />)
    expect(container).toMatchSnapshot()
  })

  it('renders negative drift', () => {
    const { container } = render(<DriftGauge drift={-3.5} threshold={5} />)
    expect(container).toMatchSnapshot()
  })
})
