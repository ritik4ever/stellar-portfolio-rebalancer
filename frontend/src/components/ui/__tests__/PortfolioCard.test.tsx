import { describe, it, expect, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PortfolioCard } from '../PortfolioCard'

describe('PortfolioCard snapshot', () => {
  beforeEach(() => {
    cleanup()
  })

  it('renders with all props', () => {
    const { container } = render(
      <PortfolioCard
        title="Total Value"
        value="$10,000.00"
        change={3.4}
        subtitle="Last rebalanced 2 hours ago"
      />
    )
    expect(container).toMatchSnapshot()
  })

  it('renders without change', () => {
    const { container } = render(
      <PortfolioCard title="Total Value" value="$5,000.00" />
    )
    expect(container).toMatchSnapshot()
  })

  it('renders negative change', () => {
    const { container } = render(
      <PortfolioCard title="Total Value" value="$5,000.00" change={-2.1} />
    )
    expect(container).toMatchSnapshot()
  })

  it('renders with actions', () => {
    const { container } = render(
      <PortfolioCard
        title="Total Value"
        value="$10,000.00"
        change={1.5}
        actions={<button>Export</button>}
      />
    )
    expect(container).toMatchSnapshot()
  })
})
