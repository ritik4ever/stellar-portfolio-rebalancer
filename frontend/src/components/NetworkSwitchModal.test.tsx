import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NetworkSwitchModal } from './NetworkSwitchModal'
import '@testing-library/jest-dom'

describe('NetworkSwitchModal', () => {
  it('renders correctly for a testnet to mainnet switch', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <NetworkSwitchModal
        currentNetwork="testnet"
        pendingNetwork="mainnet"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    expect(screen.getByText(/Network Switch Detected/i)).toBeInTheDocument()
    expect(screen.getByText(/Warning: Real Funds Implication/i)).toBeInTheDocument()
    
    const confirmButton = screen.getByRole('button', { name: /Proceed to Mainnet/i })
    expect(confirmButton).toBeInTheDocument()
    
    fireEvent.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    
    const cancelButton = screen.getByRole('button', { name: /Cancel Switch/i })
    fireEvent.click(cancelButton)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('renders correctly for a mainnet to testnet switch without funds warning', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <NetworkSwitchModal
        currentNetwork="mainnet"
        pendingNetwork="testnet"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    expect(screen.queryByText(/Warning: Real Funds Implication/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Proceed to Testnet/i })).toBeInTheDocument()
  })
})
