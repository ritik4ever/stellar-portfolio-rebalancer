import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { WalletPicker } from './WalletPicker'

const mockWalletManager = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  getWalletType: vi.fn(),
  getPublicKey: vi.fn(),
}))

vi.mock('../utils/walletManager', () => ({
  walletManager: mockWalletManager,
}))

vi.mock('../lib/wallet', () => ({
  SUPPORTED_WALLETS: [
    { name: 'Freighter', type: 'freighter', installUrl: 'https://www.freighter.app/' },
    { name: 'Rabet', type: 'rabet', installUrl: 'https://rabet.io/' },
    { name: 'xBull', type: 'xbull', installUrl: 'https://xbull.app/' },
    { name: 'LOBSTR', type: 'lobstr', installUrl: 'https://lobstr.co/' },
    { name: 'WalletConnect', type: 'walletconnect', installUrl: 'https://walletconnect.com/' },
  ],
  getLastUsedWallet: vi.fn(() => null),
  setLastUsedWallet: vi.fn(),
  clearLastUsedWallet: vi.fn(),
}))

describe('WalletPicker', () => {
  let mockOnConnect: (publicKey: string, walletType: string) => void
  let mockOnError: (error: string) => void

  beforeEach(() => {
    cleanup()
    vi.restoreAllMocks()

    mockOnConnect = vi.fn()
    mockOnError = vi.fn()

    mockWalletManager.getWalletType.mockReturnValue(null)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders all supported wallet options', () => {
    render(<WalletPicker onConnect={mockOnConnect} onError={mockOnError} />)

    expect(screen.getByText('Freighter')).toBeTruthy()
    expect(screen.getByText('Rabet')).toBeTruthy()
    expect(screen.getByText('xBull')).toBeTruthy()
    expect(screen.getByText('LOBSTR')).toBeTruthy()
    expect(screen.getByText('WalletConnect')).toBeTruthy()
  })

  it('detects Lobstr as installed when window.lobstr is available', () => {
    window.lobstr = {} as any
    render(<WalletPicker onConnect={mockOnConnect} onError={mockOnError} />)
    expect(screen.getByText('Installed')).toBeTruthy()
    delete (window as any).lobstr
  })

  it('calls walletManager.connect with lobstr when Lobstr is clicked', async () => {
    window.lobstr = {} as any
    const testPublicKey = 'GAlobstrtest1234567890abcdef1234567890abcdef1234567890abcdef'
    mockWalletManager.connect.mockResolvedValue(testPublicKey)

    render(<WalletPicker onConnect={mockOnConnect} onError={mockOnError} />)

    const lobstrButton = screen.getByText('LOBSTR').closest('button')
    expect(lobstrButton).toBeTruthy()

    fireEvent.click(lobstrButton!)

    await waitFor(() => {
      expect(mockWalletManager.connect).toHaveBeenCalledWith('lobstr')
      expect(mockOnConnect).toHaveBeenCalledWith(testPublicKey, 'LOBSTR')
      expect(mockOnError).not.toHaveBeenCalled()
    })

    delete (window as any).lobstr
  })
})
