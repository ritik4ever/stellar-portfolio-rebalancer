import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WalletManager } from './walletManager'
import * as adapters from './walletAdapters'

describe('WalletManager', () => {
  let walletManager: WalletManager

  beforeEach(() => {
    localStorage.clear()
    walletManager = new WalletManager()
    vi.clearAllMocks()
  })

  it('connects to a supported wallet and persists state', async () => {
    const mockAdapter = {
      name: 'Freighter',
      type: 'freighter',
      isAvailable: vi.fn().mockReturnValue(true),
      connect: vi.fn().mockResolvedValue('GABC...'),
      isConnected: vi.fn().mockResolvedValue(true),
    }

    vi.spyOn(adapters, 'getAdapter').mockReturnValue(mockAdapter as any)

    const publicKey = await walletManager.connect('freighter')

    expect(publicKey).toBe('GABC...')
    expect(localStorage.getItem('wallet_type')).toBe('freighter')
    expect(localStorage.getItem('stellar_public_key')).toBe('GABC...')
    expect(localStorage.getItem('wallet_connected')).toBe('true')
  })

  it('reconnects using saved localStorage state', async () => {
    localStorage.setItem('wallet_type', 'rabet')
    localStorage.setItem('stellar_public_key', 'GDEF...')
    
    const mockAdapter = {
      name: 'Rabet',
      type: 'rabet',
      isAvailable: vi.fn().mockReturnValue(true),
      isConnected: vi.fn().mockResolvedValue(true),
    }

    vi.spyOn(adapters, 'getAdapter').mockReturnValue(mockAdapter as any)

    const publicKey = await walletManager.reconnect()

    expect(publicKey).toBe('GDEF...')
    expect(walletManager.getPublicKey()).toBe('GDEF...')
    expect(walletManager.getWalletType()).toBe('rabet')
  })

  it('returns null when reconnecting with unsupported wallet name', async () => {
    localStorage.setItem('wallet_type', 'invalid-wallet' as any)
    localStorage.setItem('stellar_public_key', 'GXYZ...')

    vi.spyOn(adapters, 'getAdapter').mockReturnValue(null)

    const result = await walletManager.reconnect()

    expect(result).toBeNull()
    expect(localStorage.getItem('wallet_type')).toBeNull() // Should clear storage
  })

  it('handles adapter initialization failure during connection', async () => {
    const mockAdapter = {
      name: 'xBull',
      type: 'xbull',
      isAvailable: vi.fn().mockReturnValue(true),
      connect: vi.fn().mockRejectedValue(new Error('Connection failed')),
    }

    vi.spyOn(adapters, 'getAdapter').mockReturnValue(mockAdapter as any)

    await expect(walletManager.connect('xbull')).rejects.toThrow('Connection failed')
    expect(localStorage.getItem('wallet_connected')).toBeNull()
  })

  it('gracefully handles missing adapter for supported type', async () => {
    vi.spyOn(adapters, 'getAdapter').mockReturnValue(null)

    await expect(walletManager.connect('freighter')).rejects.toThrow(/adapter not found/i)
  })

  it('clears storage on disconnect', async () => {
    localStorage.setItem('wallet_type', 'freighter')
    localStorage.setItem('wallet_connected', 'true')

    await walletManager.disconnect()

    expect(localStorage.getItem('wallet_type')).toBeNull()
    expect(localStorage.getItem('wallet_connected')).toBeNull()
  })
})
