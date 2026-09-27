import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Modal } from '../Modal'

describe('Modal', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    // Create a button that will trigger the modal
    const triggerButton = document.createElement('button')
    triggerButton.id = 'trigger-button'
    triggerButton.textContent = 'Open Modal'
    document.body.appendChild(triggerButton)
    triggerButton.focus()
  })

  afterEach(() => {
    cleanup()
    const triggerButton = document.getElementById('trigger-button')
    if (triggerButton) {
      triggerButton.remove()
    }
  })

  it('should render modal when open is true', () => {
    render(
      <Modal open={true} onClose={mockOnClose} title="Test Modal" description="Test description">
        <p>Modal content</p>
      </Modal>
    )

    expect(screen.getByText('Test Modal')).toBeInTheDocument()
    expect(screen.getByText('Test description')).toBeInTheDocument()
    expect(screen.getByText('Modal content')).toBeInTheDocument()
  })

  it('should not render modal when open is false', () => {
    render(
      <Modal open={false} onClose={mockOnClose} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    )

    expect(screen.queryByText('Test Modal')).not.toBeInTheDocument()
  })

  it('should call onClose when Escape key is pressed', () => {
    render(
      <Modal open={true} onClose={mockOnClose} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('should trap focus within modal when Tab is pressed on last focusable element', () => {
    render(
      <Modal open={true} onClose={mockOnClose} title="Test Modal" footer={
        <>
          <button>Cancel</button>
          <button>Submit</button>
        </>
      }>
        <input type="text" placeholder="Enter text" />
        <button>Inner Button</button>
      </Modal>
    )

    const buttons = screen.getAllByRole('button')
    const input = screen.getByPlaceholderText('Enter text')

    // Focus on the last button (Submit)
    const submitButton = buttons[buttons.length - 1]
    submitButton.focus()

    // Press Tab - focus should cycle to first focusable element
    fireEvent.keyDown(document, { key: 'Tab' })

    // Focus should be on the first focusable element (input)
    expect(document.activeElement).toBe(input)
  })

  it('should trap focus within modal when Shift+Tab is pressed on first focusable element', () => {
    render(
      <Modal open={true} onClose={mockOnClose} title="Test Modal" footer={
        <>
          <button>Cancel</button>
          <button>Submit</button>
        </>
      }>
        <input type="text" placeholder="Enter text" />
        <button>Inner Button</button>
      </Modal>
    )

    const buttons = screen.getAllByRole('button')
    const input = screen.getByPlaceholderText('Enter text')

    // Focus on the first focusable element
    input.focus()

    // Press Shift+Tab - focus should cycle to last focusable element
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

    // Focus should be on the last focusable element (Submit button)
    const submitButton = buttons[buttons.length - 1]
    expect(document.activeElement).toBe(submitButton)
  })

  it('should restore focus to trigger element when modal closes', () => {
    const { rerender } = render(
      <Modal open={true} onClose={mockOnClose} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    )

    const triggerButton = document.getElementById('trigger-button') as HTMLElement

    // Modal is open, focus should be on modal
    expect(document.activeElement).not.toBe(triggerButton)

    // Close the modal
    rerender(
      <Modal open={false} onClose={mockOnClose} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    )

    // Focus should be restored to trigger button
    expect(document.activeElement).toBe(triggerButton)
  })

  it('should have proper ARIA attributes', () => {
    render(
      <Modal open={true} onClose={mockOnClose} title="Test Modal" description="Test description">
        <p>Modal content</p>
      </Modal>
    )

    const modal = screen.getByRole('dialog')
    const titleElement = screen.getByText('Test Modal')
    const descriptionElement = screen.getByText('Test description')

    expect(modal).toHaveAttribute('aria-modal', 'true')
    expect(modal).toHaveAttribute('aria-labelledby', titleElement.id)
    expect(modal).toHaveAttribute('aria-describedby', descriptionElement.id)
  })

  it('moves focus into modal when container is focused and Tab is pressed', () => {
    render(
      <Modal open={true} onClose={mockOnClose} title="Test Modal">
        <input type="text" placeholder="Enter text" />
        <button>Inner Button</button>
      </Modal>
    )

    const modal = screen.getByRole('dialog') as HTMLElement
    const input = screen.getByPlaceholderText('Enter text') as HTMLElement

    // Focus the modal container itself (simulating initial focus)
    modal.focus()

    // Press Tab - focus should move into the first focusable element
    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(input)
  })

  it('keeps focus on modal when no focusable elements exist and Tab is pressed', () => {
    render(
      <Modal open={true} onClose={mockOnClose} title="Test Modal">
        <div>Static content</div>
      </Modal>
    )

    const modal = screen.getByRole('dialog') as HTMLElement

    // Focus the modal container
    modal.focus()

    // Press Tab - with no focusable elements, focus should remain on modal
    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(modal)
  })
})
