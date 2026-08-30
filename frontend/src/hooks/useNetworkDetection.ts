import { useState, useEffect, useCallback } from 'react'
import { walletManager } from '../utils/walletManager'
import {
  StellarNetwork,
  NetworkDetectionResult,
  getConfiguredNetwork,
  detectWalletNetwork,
} from '../utils/networkDetection'

export function useNetworkDetection(): NetworkDetectionResult & {
  recheck: () => void
  confirmNetworkSwitch: () => void
  cancelNetworkSwitch: () => void
} {
  const [configuredNetwork] = useState<StellarNetwork>(getConfiguredNetwork)
  const [walletNetwork, setWalletNetwork] = useState<StellarNetwork | null>(null)
  const [pendingWalletNetwork, setPendingWalletNetwork] = useState<StellarNetwork | null>(null)
  const [ignoredWalletNetwork, setIgnoredWalletNetwork] = useState<StellarNetwork | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const checkNetwork = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      const walletType = walletManager.getWalletType() ?? undefined
      if (!walletType) return
      const detected = await detectWalletNetwork(walletType)
      
      setWalletNetwork((prev) => {
        if (prev === null) {
          return detected
        }
        if (detected !== prev && detected !== ignoredWalletNetwork) {
          setPendingWalletNetwork(detected)
          return prev
        }
        return prev
      })
    } catch (err) {
      setWalletNetwork(null)
      setError(err instanceof Error ? err.message : 'Failed to detect wallet network')
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    checkNetwork()
    const intervalId = setInterval(checkNetwork, 3000)
    return () => clearInterval(intervalId)
  }, [checkNetwork])

  const confirmNetworkSwitch = useCallback(() => {
    if (pendingWalletNetwork) {
      setWalletNetwork(pendingWalletNetwork)
      setIgnoredWalletNetwork(null)
      setPendingWalletNetwork(null)
    }
  }, [pendingWalletNetwork])

  const cancelNetworkSwitch = useCallback(() => {
    if (pendingWalletNetwork) {
      setIgnoredWalletNetwork(pendingWalletNetwork)
      setPendingWalletNetwork(null)
    }
  }, [pendingWalletNetwork])

  const mismatch =
    !checking &&
    walletNetwork !== null &&
    configuredNetwork !== 'unknown' &&
    walletNetwork !== 'unknown' &&
    walletNetwork !== configuredNetwork

  return {
    configuredNetwork,
    walletNetwork,
    pendingWalletNetwork,
    mismatch,
    checking,
    error,
    recheck: checkNetwork,
    confirmNetworkSwitch,
    cancelNetworkSwitch,
  }
}
