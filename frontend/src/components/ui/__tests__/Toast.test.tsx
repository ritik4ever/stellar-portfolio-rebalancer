import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toast, ToastStack } from '../Toast'

describe('ToastStack', () => {
  it('stacks multiple toasts vertically instead of overwriting', () => {
    render(
      <ToastStack
        toasts={[
          { id: '1', title: 'First toast', tone: 'info' },
          { id: '2', title: 'Second toast', tone: 'success' },
          { id: '3', title: 'Third toast', tone: 'error' },
        ]}
      />,
    )

    const stack = screen.getByLabelText('Notifications')
    expect(stack).toHaveClass('flex', 'flex-col')
    expect(screen.getByText('First toast')).toBeInTheDocument()
    expect(screen.getByText('Second toast')).toBeInTheDocument()
    expect(screen.getByText('Third toast')).toBeInTheDocument()
  })

  it('dismisses an individual toast without hiding the rest', () => {
    const onDismiss = vi.fn()
    render(
      <ToastStack
        toasts={[
          { id: 'a', title: 'Keep me', tone: 'info' },
          { id: 'b', title: 'Dismiss me', tone: 'warning' },
        ]}
        onDismiss={onDismiss}
      />,
    )

    const dismissButtons = screen.getAllByLabelText('Dismiss')
    fireEvent.click(dismissButtons[1])
    expect(onDismiss).toHaveBeenCalledWith('b')
    expect(onDismiss).not.toHaveBeenCalledWith('a')
    expect(screen.getByText('Keep me')).toBeInTheDocument()
  })
})
