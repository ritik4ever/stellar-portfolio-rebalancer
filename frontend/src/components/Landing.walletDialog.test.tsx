import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Landing from './Landing'

vi.mock('./WalletSelector', () => ({
  WalletSelector: () => <button type="button">Connect to Freighter</button>,
}))
vi.mock('./SystemStatusPanel', () => ({ default: () => null }))
vi.mock('./ThemeToggle', () => ({ default: () => null }))
vi.mock('../config/api', () => ({ api: { get: vi.fn() }, ENDPOINTS: { CONSENT_STATUS: '/c' } }))

afterEach(cleanup)

const open = () => {
  render(<Landing onNavigate={vi.fn()} onConnectWallet={vi.fn()} isConnecting={false} publicKey={null} />)
  const opener = screen.getAllByRole('button', { name: /connect wallet/i })[0]
  opener.focus()
  fireEvent.click(opener)
  return opener
}

describe('Landing wallet dialog', () => {
  it('is a labelled modal dialog with a named close button', () => {
    open()
    const dialog = screen.getByRole('dialog', { name: 'Select Wallet' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Close wallet selection' })).toBeInTheDocument()
  })

  it('moves focus inside, closes on Escape, and returns focus to the opener', () => {
    const opener = open()
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes from the close button and returns focus to the opener', () => {
    const opener = open()
    fireEvent.click(screen.getByRole('button', { name: 'Close wallet selection' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
