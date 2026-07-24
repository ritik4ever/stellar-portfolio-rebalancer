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
} {
  const [configuredNetwork] = useState<StellarNetwork>(getConfiguredNetwork)
  const [walletNetwork, setWalletNetwork] = useState<StellarNetwork | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const checkNetwork = useCallback(async () => {
    setChecking(true)
    setError(null)
    try {
      const walletType = walletManager.getWalletType() ?? undefined
      const detected = await detectWalletNetwork(walletType)
      setWalletNetwork(detected)
    } catch (err) {
      setWalletNetwork(null)
      setError(err instanceof Error ? err.message : 'Failed to detect wallet network')
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    checkNetwork()
  }, [checkNetwork])

  const mismatch =
    !checking &&
    walletNetwork !== null &&
    configuredNetwork !== 'unknown' &&
    walletNetwork !== 'unknown' &&
    walletNetwork !== configuredNetwork

  return {
    configuredNetwork,
    walletNetwork,
    mismatch,
    checking,
    error,
    recheck: checkNetwork,
  }
}
