import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { AllocationSlider } from '../AllocationSlider'
import { vi } from 'vitest'

describe('AllocationSlider', () => {
  it('renders correctly with initial value', () => {
    render(<AllocationSlider label="Stock" value={50} onChange={() => {}} />)
    expect(screen.getByLabelText('Stock')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('handles regular arrow keys to increment/decrement value', () => {
    const handleChange = vi.fn()
    render(<AllocationSlider label="Stock" value={50} onChange={handleChange} step={1} />)
    
    const slider = screen.getByRole('slider')
    
    // ArrowRight increments by step (1)
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(handleChange).toHaveBeenCalledWith(51)
    
    // ArrowLeft decrements by step (1)
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(handleChange).toHaveBeenCalledWith(49)
  })

  it('handles Shift + arrow keys for larger increments', () => {
    const handleChange = vi.fn()
    render(<AllocationSlider label="Stock" value={50} onChange={handleChange} step={1} />)
    
    const slider = screen.getByRole('slider')
    
    // Shift + ArrowRight increments by large step (10)
    fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true })
    expect(handleChange).toHaveBeenCalledWith(60)
    
    // Shift + ArrowLeft decrements by large step (10)
    fireEvent.keyDown(slider, { key: 'ArrowLeft', shiftKey: true })
    expect(handleChange).toHaveBeenCalledWith(40)
  })

  it('updates aria attributes correctly', () => {
    const { rerender } = render(<AllocationSlider label="Stock" value={50} onChange={() => {}} />)
    
    let slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuenow', '50')
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '100')

    // Rerender with new value
    rerender(<AllocationSlider label="Stock" value={65} onChange={() => {}} />)
    slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-valuenow', '65')
  })
})
