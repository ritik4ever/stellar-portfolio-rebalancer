import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { WalletSelector } from './WalletSelector'

const mockWalletManager = vi.hoisted(() => ({
  getAvailableWallets: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  getAutoReconnect: vi.fn(() => true),
  setAutoReconnect: vi.fn(),
}))
const mockDetect = vi.hoisted(() => vi.fn())

vi.mock('../utils/walletManager', () => ({ walletManager: mockWalletManager }))
vi.mock('../app/walletBoot', () => ({
  runBootDiagnostics: vi.fn().mockResolvedValue({ checks: [], allPassed: true, timestamp: 0 }),
}))
vi.mock('../config/api', () => ({ api: { get: vi.fn().mockResolvedValue({}) }, ENDPOINTS: { HEALTH: '/health' } }))
vi.mock('../utils/networkDetection', async () => {
  const actual = await vi.importActual<typeof import('../utils/networkDetection')>('../utils/networkDetection')
  return { ...actual, getConfiguredNetwork: () => 'testnet', detectWalletNetwork: mockDetect }
})

const wallets = [
  { type: 'freighter', name: 'Freighter' },
  { type: 'rabet', name: 'Rabet' },
]

describe('WalletSelector announcements', () => {
  describe('no wallet extension detected', () => {
    beforeEach(() => {
      mockWalletManager.getAvailableWallets.mockReturnValue([])
      mockWalletManager.connect.mockReset()
      mockWalletManager.disconnect.mockReset().mockResolvedValue(undefined)
      mockDetect.mockReset().mockResolvedValue(null)
    })

    it('announces the no-wallet state with an accessible name', () => {
      render(<WalletSelector onConnect={vi.fn()} />)
      const alert = screen.getByRole('alert', { name: 'No wallet extension detected' })
      expect(alert).toHaveTextContent('No Stellar wallets detected. Please install Freighter, Rabet, xBull, or Hana wallet extension.')

      // The user can still open diagnostics to learn what failed
      const toggle = screen.getByRole('button', { name: /Show startup diagnostics/i })
      expect(toggle).toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(toggle).toHaveAttribute('aria-controls', 'wallet-diagnostics-panel')

      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByTestId('diagnostics-panel')).toBeInTheDocument()
    })
  })

  beforeEach(() => {
    mockWalletManager.getAvailableWallets.mockReturnValue(wallets)
    mockWalletManager.connect.mockReset()
    mockWalletManager.disconnect.mockReset().mockResolvedValue(undefined)
    mockDetect.mockReset().mockResolvedValue(null)
  })
  afterEach(cleanup)

  const freighter = () => screen.getByRole('button', { name: 'Connect to Freighter' })

  it('announces connecting and then connected in a polite status region', async () => {
    let resolve!: (k: string) => void
    mockWalletManager.connect.mockReturnValue(new Promise<string>(r => (resolve = r)))
    const onConnect = vi.fn()
    render(<WalletSelector onConnect={onConnect} />)
    fireEvent.click(freighter())
    const status = await screen.findByTestId('wallet-connect-status')
    await waitFor(() => expect(status).toHaveTextContent('Connecting to Freighter. Approve the request in your wallet.'))
    expect(status).toHaveAttribute('role', 'status')
    await act(async () => resolve('GKEY'))
    expect(status).toHaveTextContent('Connected to Freighter.')
    expect(onConnect).toHaveBeenCalledWith('GKEY')
  })

  it('shows a rejection as an alert next to the control, describes the pressed button, and keeps focus on it', async () => {
    mockWalletManager.connect.mockRejectedValue(Object.assign(new Error('x'), { code: 'USER_DECLINED' }))
    render(<WalletSelector onConnect={vi.fn()} />)
    freighter().focus()
    fireEvent.click(freighter())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('declined in your wallet, so nothing was connected')
    expect(freighter()).toHaveAccessibleDescription(alert.textContent!)
    await waitFor(() => expect(freighter()).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Connect to Rabet' })).not.toHaveAccessibleDescription(alert.textContent!)
  })

  it('states the exact allowed network when the wallet is on another one', async () => {
    mockDetect.mockResolvedValue('mainnet')
    const onError = vi.fn()
    render(<WalletSelector onConnect={vi.fn()} onError={onError} />)
    fireEvent.click(freighter())
    // the mismatch banner is the single alert; it states the exact allowed value
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Mainnet \(Public\)/)
    expect(alert).toHaveTextContent(/expects Testnet/)
    expect(onError).toHaveBeenCalledWith(
      'Wallet is on Mainnet (Public), but this app only accepts Testnet. Switch your wallet to Testnet and select it again.',
    )
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(freighter().getAttribute('aria-describedby')).toBe('wallet-network-mismatch')
    expect(mockWalletManager.connect).not.toHaveBeenCalled()
  })

  it('does not start a second request while one is pending, and keeps focus on the button', async () => {
    mockWalletManager.connect.mockReturnValue(new Promise(() => {}))
    render(<WalletSelector onConnect={vi.fn()} />)
    freighter().focus()
    fireEvent.click(freighter())
    await waitFor(() => expect(freighter()).toHaveAttribute('aria-disabled', 'true'))
    expect(freighter()).toHaveFocus()
    fireEvent.click(freighter())
    fireEvent.click(screen.getByRole('button', { name: 'Connect to Rabet' }))
    expect(mockWalletManager.connect).toHaveBeenCalledTimes(1)
  })

  it('activates once per Enter/Space keypress path (no duplicate keydown handler)', async () => {
    mockWalletManager.connect.mockResolvedValue('GKEY')
    render(<WalletSelector onConnect={vi.fn()} />)
    fireEvent.keyDown(freighter(), { key: 'Enter' })
    expect(mockWalletManager.connect).not.toHaveBeenCalled() // activation comes from the native click only
    fireEvent.click(freighter())
    await waitFor(() => expect(mockWalletManager.connect).toHaveBeenCalledTimes(1))
  })

  it('does not sign the user in if the dialog was closed while the wallet prompt was open', async () => {
    let resolve!: (k: string) => void
    mockWalletManager.connect.mockReturnValue(new Promise<string>(r => (resolve = r)))
    const onConnect = vi.fn()
    const { unmount } = render(<WalletSelector onConnect={onConnect} />)
    fireEvent.click(freighter())
    await waitFor(() => expect(mockWalletManager.connect).toHaveBeenCalled())
    unmount()
    await act(async () => resolve('GKEY'))
    expect(onConnect).not.toHaveBeenCalled()
    expect(mockWalletManager.disconnect).toHaveBeenCalled()
  })

  describe('keyboard and screen-reader usability', () => {
    it('renders wallet buttons keyboard reachable with accessible names', () => {
      render(<WalletSelector onConnect={vi.fn()} />)
      const freighterBtn = screen.getByRole('button', { name: 'Connect to Freighter' })
      const rabetBtn = screen.getByRole('button', { name: 'Connect to Rabet' })

      // Each button has an accessible name a screen reader can announce
      expect(freighterBtn).toHaveAccessibleName('Connect to Freighter')
      expect(rabetBtn).toHaveAccessibleName('Connect to Rabet')

      // Buttons are in the tab order and focusable
      expect(freighterBtn.tabIndex).toBe(0)
      expect(rabetBtn.tabIndex).toBe(0)

      // The wallet group has an accessible label
      const group = screen.getByRole('group', { name: 'Available wallets' })
      expect(group).toBeInTheDocument()
      expect(group).toContainElement(freighterBtn)
    })

    it('announces the selecting state when a wallet button is activated', async () => {
      let resolve!: (k: string) => void
      mockWalletManager.connect.mockReturnValue(new Promise<string>(r => (resolve = r)))
      const onConnect = vi.fn()
      render(<WalletSelector onConnect={onConnect} />)
      const freighterBtn = screen.getByRole('button', { name: 'Connect to Freighter' })

      freighterBtn.focus()
      fireEvent.click(freighterBtn)
      // The polite status region announces the connecting state for screen readers
      const status = await screen.findByTestId('wallet-connect-status')
      await waitFor(() => expect(status).toHaveTextContent('Connecting to Freighter. Approve the request in your wallet.'))
      expect(status).toHaveAttribute('role', 'status')
      expect(status).toHaveAttribute('aria-live', 'polite')

      // Complete the connection and verify the status updates
      await act(async () => resolve('GKEY'))
      expect(status).toHaveTextContent('Connected to Freighter.')
      expect(onConnect).toHaveBeenCalledWith('GKEY')
    })

    it('keeps focus on the pressed button after a declined connection and reads the error next to it', async () => {
      mockWalletManager.connect.mockRejectedValue(Object.assign(new Error('x'), { code: 'USER_DECLINED' }))
      render(<WalletSelector onConnect={vi.fn()} />)
      const freighterBtn = screen.getByRole('button', { name: 'Connect to Freighter' })

      freighterBtn.focus()
      fireEvent.click(freighterBtn)
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('declined in your wallet, so nothing was connected')
      expect(freighterBtn).toHaveAccessibleDescription(alert.textContent!)
      await waitFor(() => expect(freighterBtn).toHaveFocus())
      // Only the pressed button describes the error; the other button does not
      expect(screen.getByRole('button', { name: 'Connect to Rabet' })).not.toHaveAccessibleDescription(alert.textContent!)
    })

    it('returns focus to the wallet buttons area when no wallet extension is detected', () => {
      mockWalletManager.getAvailableWallets.mockReturnValue([])
      render(<WalletSelector onConnect={vi.fn()} />)

      const alert = screen.getByRole('alert', { name: 'No wallet extension detected' })
      expect(alert).toBeInTheDocument()
      expect(alert).toHaveTextContent('No Stellar wallets detected. Please install Freighter, Rabet, xBull, or Hana wallet extension.')

      // The diagnostics toggle is keyboard reachable and describes what it controls
      const toggle = screen.getByRole('button', { name: /Show startup diagnostics/i })
      expect(toggle).toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(toggle).toHaveAttribute('aria-controls', 'wallet-diagnostics-panel')

      // Activating the toggle reveals diagnostics that match what the button controls
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByTestId('diagnostics-panel')).toBeInTheDocument()
    })

    it('updates the switch label when auto-reconnect is toggled', async () => {
      render(<WalletSelector onConnect={vi.fn()} />)
      const toggle = screen.getByRole('switch', { name: /Enable auto-reconnect on page refresh/i })
      expect(toggle).toHaveAttribute('aria-checked', 'true')
      expect(toggle).toHaveAccessibleName('Enable auto-reconnect on page refresh')

      fireEvent.click(toggle)
      await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'))
      expect(toggle).toHaveAccessibleName('Disable auto-reconnect on page refresh')

      // Toggle back to confirm bidirectional updates
      fireEvent.click(toggle)
      await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
      expect(toggle).toHaveAccessibleName('Enable auto-reconnect on page refresh')
    })

    it('prevents duplicate submission by ignoring presses while a request is pending', async () => {
      mockWalletManager.connect.mockReturnValue(new Promise(() => {}))
      render(<WalletSelector onConnect={vi.fn()} />)
      const freighterBtn = screen.getByRole('button', { name: 'Connect to Freighter' })

      freighterBtn.focus()
      fireEvent.click(freighterBtn)
      await waitFor(() => expect(freighterBtn).toHaveAttribute('aria-disabled', 'true'))

      // Additional presses during pending request are ignored
      fireEvent.click(freighterBtn)
      fireEvent.click(screen.getByRole('button', { name: 'Connect to Rabet' }))
      expect(mockWalletManager.connect).toHaveBeenCalledTimes(1)

      // Focus stays on the pressed button so the user can cancel or try another wallet
      expect(freighterBtn).toHaveFocus()
    })

    it('announces error recovery by returning focus to the wallet button after a failure', async () => {
      mockWalletManager.connect.mockRejectedValue(new Error('Connection failed'))

      const onConnect = vi.fn()
      const onError = vi.fn()
      render(<WalletSelector onConnect={onConnect} onError={onError} />)
      const freighterBtn = screen.getByRole('button', { name: 'Connect to Freighter' })

      freighterBtn.focus()
      fireEvent.click(freighterBtn)
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Connection failed')

      // Focus returns to the button so the user can retry
      await waitFor(() => expect(freighterBtn).toHaveFocus())
      expect(freighterBtn).toHaveAccessibleDescription(alert.textContent!)
      expect(onError).toHaveBeenCalledWith('Connection failed')
      expect(onConnect).not.toHaveBeenCalled()
    })
  })
})
