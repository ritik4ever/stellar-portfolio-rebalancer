import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup, within } from '@testing-library/react'
import { ToastProvider, useToast } from './ToastContext'
import { ToastContainer } from '../components/ui/ToastContainer'

function ToastProbe() {
  const { showToast } = useToast()
  return (
    <div>
      <button type="button" onClick={() => showToast({ title: 'Toast A', description: 'First', tone: 'info' })}>
        Show A
      </button>
      <button type="button" onClick={() => showToast({ title: 'Toast B', description: 'Second', tone: 'success' })}>
        Show B
      </button>
      <button type="button" onClick={() => showToast({ title: 'Toast C', description: 'Third', tone: 'warning' })}>
        Show C
      </button>
      <button type="button" onClick={() => showToast({ title: 'Toast D', description: 'Fourth', tone: 'error' })}>
        Show D
      </button>
      <button type="button" onClick={() => showToast({ title: 'Toast E', description: 'Fifth', tone: 'info' })}>
        Show E
      </button>
      <button type="button" onClick={() => showToast({ title: 'Toast F', description: 'Sixth', tone: 'success' })}>
        Show F
      </button>
      <ToastContainer />
    </div>
  )
}

function renderWithProvider(maxVisible?: number) {
  return render(
    <ToastProvider maxVisible={maxVisible} duration={5000}>
      <ToastProbe />
    </ToastProvider>,
  )
}

describe('ToastContext', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('stacks multiple toasts simultaneously', () => {
    renderWithProvider()

    act(() => {
      screen.getByRole('button', { name: 'Show A' }).click()
      screen.getByRole('button', { name: 'Show B' }).click()
      screen.getByRole('button', { name: 'Show C' }).click()
    })

    const container = screen.getByLabelText('Notifications')
    expect(container).toBeInTheDocument()
    expect(within(container).getByText('Toast A')).toBeInTheDocument()
    expect(within(container).getByText('Toast B')).toBeInTheDocument()
    expect(within(container).getByText('Toast C')).toBeInTheDocument()
  })

  it('respects maxVisible limit and queues excess toasts', () => {
    renderWithProvider(2)

    act(() => {
      screen.getByRole('button', { name: 'Show A' }).click()
      screen.getByRole('button', { name: 'Show B' }).click()
      screen.getByRole('button', { name: 'Show C' }).click()
    })

    const container = screen.getByLabelText('Notifications')
    expect(within(container).getByText('Toast A')).toBeInTheDocument()
    expect(within(container).getByText('Toast B')).toBeInTheDocument()
    expect(within(container).queryByText('Toast C')).not.toBeInTheDocument()
  })

  it('dismisses toasts independently with their own timers', () => {
    renderWithProvider()

    act(() => {
      screen.getByRole('button', { name: 'Show A' }).click()
      screen.getByRole('button', { name: 'Show B' }).click()
    })

    const container = screen.getByLabelText('Notifications')
    expect(within(container).getByText('Toast A')).toBeInTheDocument()
    expect(within(container).getByText('Toast B')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(container.children.length).toBe(0)
  })

  it('shows queued toast when a visible toast dismisses', () => {
    render(
      <ToastProvider maxVisible={1} duration={3000}>
        <ToastProbe />
      </ToastProvider>,
    )

    act(() => {
      screen.getByRole('button', { name: 'Show A' }).click()
      screen.getByRole('button', { name: 'Show B' }).click()
    })

    const container = screen.getByLabelText('Notifications')
    expect(within(container).getByText('Toast A')).toBeInTheDocument()
    expect(within(container).queryByText('Toast B')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(within(container).getByText('Toast B')).toBeInTheDocument()
  })

  it('dismisses toast via dismiss button', () => {
    renderWithProvider()

    act(() => {
      screen.getByRole('button', { name: 'Show A' }).click()
    })

    const container = screen.getByLabelText('Notifications')
    expect(within(container).getByText('Toast A')).toBeInTheDocument()

    const dismissButton = within(container).getByLabelText('Dismiss')
    act(() => {
      dismissButton.click()
    })

    expect(container.children.length).toBe(0)
  })
})
