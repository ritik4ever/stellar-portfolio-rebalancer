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
})
