import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNetworkDetection } from './useNetworkDetection'
import { walletManager } from '../utils/walletManager'
import * as networkDetectionUtils from '../utils/networkDetection'

vi.mock('../utils/walletManager', () => ({
  walletManager: {
    getWalletType: vi.fn(),
  },
}))

describe('useNetworkDetection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(networkDetectionUtils, 'getConfiguredNetwork').mockReturnValue('testnet')
    vi.spyOn(networkDetectionUtils, 'detectWalletNetwork').mockResolvedValue('testnet')
    vi.mocked(walletManager.getWalletType).mockReturnValue('freighter')
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('initializes and polls for network changes', async () => {
    const { result } = renderHook(() => useNetworkDetection())
    
    // Initial state
    expect(result.current.checking).toBe(true)

    // Wait for initial check
    await act(async () => {
      vi.advanceTimersByTime(10)
      await Promise.resolve()
    })

    expect(result.current.walletNetwork).toBe('testnet')
    expect(result.current.pendingWalletNetwork).toBeNull()

    // Simulate network change in wallet
    vi.spyOn(networkDetectionUtils, 'detectWalletNetwork').mockResolvedValue('mainnet')

    // Advance time to trigger polling interval
    await act(async () => {
      vi.advanceTimersByTime(3000)
      await Promise.resolve()
    })

    // Should detect pending switch but not apply it yet
    expect(result.current.walletNetwork).toBe('testnet')
    expect(result.current.pendingWalletNetwork).toBe('mainnet')

    // Confirm switch
    act(() => {
      result.current.confirmNetworkSwitch()
    })

    expect(result.current.walletNetwork).toBe('mainnet')
    expect(result.current.pendingWalletNetwork).toBeNull()
  })

  it('allows cancelling a network switch', async () => {
    const { result } = renderHook(() => useNetworkDetection())
    
    await act(async () => {
      vi.advanceTimersByTime(10)
      await Promise.resolve()
    })

    // Simulate network change
    vi.spyOn(networkDetectionUtils, 'detectWalletNetwork').mockResolvedValue('mainnet')

    await act(async () => {
      vi.advanceTimersByTime(3000)
      await Promise.resolve()
    })

    expect(result.current.pendingWalletNetwork).toBe('mainnet')

    // Cancel switch
    act(() => {
      result.current.cancelNetworkSwitch()
    })

    expect(result.current.walletNetwork).toBe('testnet')
    expect(result.current.pendingWalletNetwork).toBeNull()

    // Advance time again to ensure we ignore the same network
    await act(async () => {
      vi.advanceTimersByTime(3000)
      await Promise.resolve()
    })

    // Should remain null because we ignored 'mainnet'
    expect(result.current.pendingWalletNetwork).toBeNull()
  })
})
