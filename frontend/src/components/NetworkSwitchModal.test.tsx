import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NetworkSwitchModal } from './NetworkSwitchModal'

afterEach(cleanup)

const setup = (props: Partial<React.ComponentProps<typeof NetworkSwitchModal>> = {}) => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <NetworkSwitchModal
      currentNetwork="testnet"
      pendingNetwork="mainnet"
      configuredNetwork="testnet"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  )
  return { onConfirm, onCancel }
}

describe('NetworkSwitchModal', () => {
  it('renders correctly for a testnet to mainnet switch', () => {
    const { onConfirm, onCancel } = setup()
    expect(screen.getByText(/Network Switch Detected/i)).toBeInTheDocument()
    expect(screen.getByText(/Warning: Real Funds Implication/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Mainnet/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Cancel Switch/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows no funds warning for a mainnet to testnet switch', () => {
    setup({ currentNetwork: 'mainnet', pendingNetwork: 'testnet' })
    expect(screen.queryByText(/Warning: Real Funds Implication/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Proceed to Testnet/i })).toBeInTheDocument()
  })

  it('is a labelled modal dialog described by what changed and what is allowed', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: /Network Switch Detected/i })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const description = dialog.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)!.textContent).join(' ')
    expect(description).toContain('switched from Testnet to Mainnet (Public)')
    expect(description).toContain('This app is set to Testnet')
    expect(description).toContain('only Testnet is accepted')
  })

  it('states the exact allowed value, or that the wallet now matches it', () => {
    setup({ currentNetwork: 'mainnet', pendingNetwork: 'testnet', configuredNetwork: 'testnet' })
    expect(screen.getByText(/Your wallet now matches it/)).toBeInTheDocument()
  })

  it('moves focus to the safe Cancel button, not the destructive confirm', () => {
    setup()
    expect(screen.getByRole('button', { name: /Cancel Switch/i })).toHaveFocus()
  })

  it('describes each button by the exact outcome of choosing it', () => {
    setup()
    const cancel = screen.getByRole('button', { name: /Cancel Switch/i })
    const confirm = screen.getByRole('button', { name: /Proceed to Mainnet/i })
    expect(cancel).toHaveAccessibleDescription(/keeps treating your wallet as being on Testnet.*won't be asked about Mainnet \(Public\) again/)
    expect(confirm).toHaveAccessibleDescription(/treats your wallet as being on Mainnet \(Public\).*Transactions will fail until your wallet is back on Testnet/)
  })

  it('Escape rejects the switch', () => {
    const { onCancel, onConfirm } = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps Tab and Shift+Tab inside the dialog', () => {
    setup()
    const cancel = screen.getByRole('button', { name: /Cancel Switch/i })
    const confirm = screen.getByRole('button', { name: /Proceed to Mainnet/i })
    confirm.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(cancel).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(confirm).toHaveFocus()
  })

  it('returns focus to the control that was focused before it opened', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(
      <NetworkSwitchModal currentNetwork="testnet" pendingNetwork="mainnet" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(opener).not.toHaveFocus()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('omits the allowed-network sentence when the configured network is unknown', () => {
    setup({ configuredNetwork: 'unknown' })
    expect(screen.queryByText(/This app is set to/)).not.toBeInTheDocument()
  })
})
