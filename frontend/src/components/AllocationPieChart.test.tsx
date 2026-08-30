import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react'
import AllocationPieChart, { redistribute } from './AllocationPieChart'
import type { AllocationData } from './AllocationPieChart'

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: (props: any) => <div {...props} />,
  Tooltip: () => <div />,
}))

const mockData: AllocationData[] = [
  { name: 'XLM', value: 40, color: '#3B82F6' },
  { name: 'USDC', value: 60, color: '#10B981' },
]

describe('redistribute', () => {
  it('redistributes proportionally when a slice increases', () => {
    const result = redistribute(mockData, 0, 65)
    expect(result[0].value).toBe(65)
    expect(result[1].value).toBe(35)
    expect(result.reduce((s, it) => s + it.value, 0)).toBe(100)
  })

  it('redistributes proportionally when a slice decreases', () => {
    const result = redistribute(mockData, 0, 20)
    expect(result[0].value).toBe(20)
    expect(result[1].value).toBe(80)
    expect(result.reduce((s, it) => s + it.value, 0)).toBe(100)
  })

  it('handles three slices correctly', () => {
    const three: AllocationData[] = [
      { name: 'A', value: 30, color: '#f00' },
      { name: 'B', value: 30, color: '#0f0' },
      { name: 'C', value: 40, color: '#00f' },
    ]
    const result = redistribute(three, 0, 50)
    expect(result[0].value).toBe(50)
    expect(result.reduce((s, it) => s + it.value, 0)).toBe(100)
  })

  it('clamps values to 0 minimum', () => {
    const two: AllocationData[] = [
      { name: 'A', value: 10, color: '#f00' },
      { name: 'B', value: 90, color: '#0f0' },
    ]
    const result = redistribute(two, 0, -5)
    expect(result[0].value).toBe(0)
    expect(result.reduce((s, it) => s + it.value, 0)).toBe(100)
  })

  it('clamps values to 100 maximum', () => {
    const two: AllocationData[] = [
      { name: 'A', value: 50, color: '#f00' },
      { name: 'B', value: 50, color: '#0f0' },
    ]
    const result = redistribute(two, 0, 120)
    expect(result[0].value).toBe(100)
    expect(result[1].value).toBe(0)
    expect(result.reduce((s, it) => s + it.value, 0)).toBe(100)
  })

  it('returns current array when diff is zero', () => {
    const result = redistribute(mockData, 0, 40)
    expect(result).toBe(mockData)
  })
})

describe('AllocationPieChart', () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

  beforeEach(() => {
    cleanup()
    Element.prototype.getBoundingClientRect = () => ({
      width: 200,
      height: 200,
      top: 0,
      left: 0,
      bottom: 200,
      right: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
  })

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
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

  it('enters edit mode when Edit is clicked', () => {
    render(<AllocationPieChart data={mockData} />)
    fireEvent.click(screen.getByTestId('edit-btn'))
    expect(screen.getByTestId('cancel-edit-btn')).toBeTruthy()
  })

  it('exits edit mode when Cancel is clicked', () => {
    render(<AllocationPieChart data={mockData} />)
    fireEvent.click(screen.getByTestId('edit-btn'))
    fireEvent.click(screen.getByTestId('cancel-edit-btn'))
    expect(screen.getByTestId('edit-btn')).toBeTruthy()
  })

  it('calls onSave with pending data when Apply is clicked', () => {
    const onSave = vi.fn()
    render(<AllocationPieChart data={mockData} onSave={onSave} />)

    fireEvent.click(screen.getByTestId('edit-btn'))

    const cell0 = screen.getByTestId('pie-cell-0')
    act(() => {
      fireEvent.mouseDown(cell0, { clientX: 100, clientY: 0 })
    })
    act(() => {
      fireEvent.mouseMove(window, { clientX: 0, clientY: 100 })
    })
    act(() => {
      fireEvent.mouseUp(window)
    })

    fireEvent.click(screen.getByTestId('apply-btn'))
    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0][0] as AllocationData[]
    expect(saved.reduce((s: number, it: AllocationData) => s + it.value, 0)).toBe(100)
  })

  it('discards pending changes when Discard is clicked', () => {
    render(<AllocationPieChart data={mockData} />)

    fireEvent.click(screen.getByTestId('edit-btn'))

    const cell0 = screen.getByTestId('pie-cell-0')
    act(() => {
      fireEvent.mouseDown(cell0, { clientX: 100, clientY: 0 })
    })
    act(() => {
      fireEvent.mouseMove(window, { clientX: 0, clientY: 100 })
    })
    act(() => {
      fireEvent.mouseUp(window)
    })

    expect(screen.getByTestId('pending-changes')).toBeTruthy()
    fireEvent.click(screen.getByTestId('discard-btn'))
    expect(screen.queryByTestId('pending-changes')).toBeNull()
  })

  it('maintains 100% total allocation after simulated drag', () => {
    render(<AllocationPieChart data={mockData} />)

    fireEvent.click(screen.getByTestId('edit-btn'))

    const cell0 = screen.getByTestId('pie-cell-0')
    act(() => {
      fireEvent.mouseDown(cell0, { clientX: 100, clientY: 0 })
    })
    act(() => {
      fireEvent.mouseMove(window, { clientX: 0, clientY: 100 })
    })
    act(() => {
      fireEvent.mouseUp(window)
    })

    const valueSpans = screen.getAllByText(/%/).filter((el) =>
      el.className.includes('font-medium')
    )
    const total = valueSpans.reduce((sum, el) => {
      const num = parseInt(el.textContent || '0', 10)
      return sum + (isNaN(num) ? 0 : num)
    }, 0)
    expect(total).toBe(100)
  })
})
