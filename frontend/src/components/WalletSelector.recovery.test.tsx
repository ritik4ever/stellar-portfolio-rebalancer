import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { WalletSelector } from './WalletSelector'

const mockWalletManager = vi.hoisted(() => ({
  getAvailableWallets: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  getAutoReconnect: vi.fn(() => true),
  setAutoReconnect: vi.fn(),
}))

vi.mock('../utils/walletManager', () => ({ walletManager: mockWalletManager }))
vi.mock('../app/walletBoot', () => ({
  runBootDiagnostics: vi.fn().mockResolvedValue({ checks: [], allPassed: true, timestamp: 0 }),
}))
vi.mock('../config/api', () => ({ api: { get: vi.fn().mockResolvedValue({}) }, ENDPOINTS: { HEALTH: '/health' } }))
vi.mock('../utils/networkDetection', async () => {
  const actual = await vi.importActual<typeof import('../utils/networkDetection')>('../utils/networkDetection')
  return { ...actual, getConfiguredNetwork: () => 'testnet', detectWalletNetwork: vi.fn().mockResolvedValue(null) }
})

const freighter = { type: 'freighter', name: 'Freighter' }
const checkAgain = () => screen.getByRole('button', { name: 'Check again' })

describe('WalletSelector extension recovery', () => {
  beforeEach(() => {
    mockWalletManager.getAvailableWallets.mockReset().mockReturnValue([])
    mockWalletManager.connect.mockReset()
    mockWalletManager.disconnect.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('offers an actionable retry that does not require reloading the page', () => {
    render(<WalletSelector onConnect={vi.fn()} />)
    expect(screen.getByText(/Already installed\? Enable and unlock it, then check again/)).toBeInTheDocument()
    expect(checkAgain()).toBeInTheDocument()
  })

  it('announces when a manual re-check still finds nothing, and keeps focus on the button', () => {
    const onConnect = vi.fn()
    render(<WalletSelector onConnect={onConnect} />)
    checkAgain().focus()
    fireEvent.click(checkAgain())
    expect(screen.getByTestId('wallet-connect-status')).toHaveTextContent(/Still no wallet found.*installed, enabled and unlocked/)
    expect(checkAgain()).toHaveFocus()
    expect(mockWalletManager.connect).not.toHaveBeenCalled()
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('shows the wallet after Check again, announces it and moves focus to it', () => {
    render(<WalletSelector onConnect={vi.fn()} />)
    checkAgain().focus()
    mockWalletManager.getAvailableWallets.mockReturnValue([freighter])
    fireEvent.click(checkAgain())
    const button = screen.getByRole('button', { name: 'Connect to Freighter' })
    expect(screen.getByTestId('wallet-connect-status')).toHaveTextContent('Freighter detected. Select a wallet to connect.')
    expect(button).toHaveFocus()
  })

  it('picks up an extension that injects late, without stealing focus from another field', () => {
    vi.useFakeTimers()
    const other = document.createElement('input')
    document.body.appendChild(other)
    render(<WalletSelector onConnect={vi.fn()} />)
    other.focus()
    mockWalletManager.getAvailableWallets.mockReturnValue([freighter])
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(screen.getByRole('button', { name: 'Connect to Freighter' })).toBeInTheDocument()
    expect(screen.getByTestId('wallet-connect-status')).toHaveTextContent('Freighter detected')
    expect(other).toHaveFocus()
    other.remove()
  })

  it('re-checks when the window regains focus after installing an extension', () => {
    vi.useFakeTimers()
    render(<WalletSelector onConnect={vi.fn()} />)
    act(() => {
      vi.advanceTimersByTime(5000) // initial polling window ends with nothing found
    })
    mockWalletManager.getAvailableWallets.mockReturnValue([freighter])
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(screen.getByRole('button', { name: 'Connect to Freighter' })).toBeInTheDocument()
  })

  it('stops polling once wallets are found', () => {
    vi.useFakeTimers()
    render(<WalletSelector onConnect={vi.fn()} />)
    mockWalletManager.getAvailableWallets.mockReturnValue([freighter])
    act(() => {
      vi.advanceTimersByTime(500)
    })
    const calls = mockWalletManager.getAvailableWallets.mock.calls.length
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(mockWalletManager.getAvailableWallets.mock.calls.length).toBe(calls)
  })

  it('explains an extension that vanished at connect time and refreshes the list', async () => {
    mockWalletManager.getAvailableWallets.mockReturnValue([freighter])
    mockWalletManager.connect.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'WALLET_NOT_INSTALLED', walletType: 'Freighter' }),
    )
    const onConnect = vi.fn()
    render(<WalletSelector onConnect={onConnect} />)
    mockWalletManager.getAvailableWallets.mockReturnValue([])
    fireEvent.click(screen.getByRole('button', { name: 'Connect to Freighter' }))
    await waitFor(() => expect(checkAgain()).toBeInTheDocument())
    expect(onConnect).not.toHaveBeenCalled()
    expect(mockWalletManager.connect).toHaveBeenCalledTimes(1)
  })
})
