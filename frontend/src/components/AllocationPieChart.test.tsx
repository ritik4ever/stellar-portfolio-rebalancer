import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import AllocationPieChart from './AllocationPieChart'

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => <div />,
  Tooltip: () => <div />,
}))

const mockData = [
  { name: 'XLM', value: 40, color: '#3B82F6' },
  { name: 'USDC', value: 60, color: '#10B981' },
]

describe('AllocationPieChart snapshot', () => {
  beforeEach(() => {
    cleanup()
  })

  it('renders chart with data', () => {
    const { container } = render(<AllocationPieChart data={mockData} />)
    expect(container).toMatchSnapshot()
  })

  it('renders loading skeleton', () => {
    const { container } = render(<AllocationPieChart data={[]} loading />)
    expect(container).toMatchSnapshot()
  })

  it('renders empty state', () => {
    const { container } = render(<AllocationPieChart data={[]} />)
    expect(container).toMatchSnapshot()
  })

  it('renders single asset', () => {
    const { container } = render(
      <AllocationPieChart data={[{ name: 'XLM', value: 100, color: '#3B82F6' }]} />
    )
    expect(container).toMatchSnapshot()
  })
})
