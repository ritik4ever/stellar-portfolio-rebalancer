export type StellarNetwork = 'testnet' | 'mainnet' | 'standalone' | 'futurenet' | 'unknown'

export interface NetworkDetectionResult {
  configuredNetwork: StellarNetwork
  walletNetwork: StellarNetwork | null
  mismatch: boolean
  checking: boolean
  error: string | null
}

const STELLAR_NETWORK_PASSPHRASES: Record<string, StellarNetwork> = {
  'Test SDF Network ; September 2015': 'testnet',
  'Public Global Stellar Network ; September 2015': 'mainnet',
  'Standalone Network ; February 2017': 'standalone',
  'Future Network ; October 2022': 'futurenet',
}

export function parseStellarNetworkPassphrase(passphrase: string): StellarNetwork {
  const lower = passphrase.toLowerCase()
  if (lower.includes('test')) return 'testnet'
  if (lower.includes('mainnet') || lower.includes('public global')) return 'mainnet'
  if (lower.includes('standalone') || lower.includes('sandbox')) return 'standalone'
  if (lower.includes('future')) return 'futurenet'
  return 'unknown'
}

export function getConfiguredNetwork(): StellarNetwork {
  if (typeof import.meta === 'undefined') return 'testnet'
  const env = import.meta.env.VITE_STELLAR_NETWORK as string | undefined
  if (!env) return 'testnet'
  const lower = env.toLowerCase()
  if (lower === 'mainnet' || lower === 'public') return 'mainnet'
  if (lower === 'testnet' || lower === 'test') return 'testnet'
  if (lower === 'standalone' || lower === 'sandbox') return 'standalone'
  if (lower === 'futurenet') return 'futurenet'
  return 'testnet'
}

export async function detectFreighterNetwork(): Promise<StellarNetwork | null> {
  try {
    if (typeof window === 'undefined' || !window.freighter) return null
    const details = await (window.freighter as any).getNetworkDetails()
    if (details?.networkPassphrase) {
      return parseStellarNetworkPassphrase(details.networkPassphrase)
    }
    if (details?.network) {
      return details.network.toLowerCase() as StellarNetwork
    }
    return null
  } catch {
    return null
  }
}

export async function detectRabetNetwork(): Promise<StellarNetwork | null> {
  try {
    if (typeof window === 'undefined' || !window.rabet) return null
    const network = await (window.rabet as any).getNetwork()
    if (typeof network === 'string') return network.toLowerCase() as StellarNetwork
    if (network?.network) return network.network.toLowerCase() as StellarNetwork
    if (network?.networkPassphrase) return parseStellarNetworkPassphrase(network.networkPassphrase)
    return null
  } catch {
    return null
  }
}

export async function detectXbullNetwork(): Promise<StellarNetwork | null> {
  try {
    if (typeof window === 'undefined' || !window.xBull) return null
    const network = await (window.xBull as any).getNetwork()
    if (typeof network === 'string') return network.toLowerCase() as StellarNetwork
    if (network?.network) return network.network.toLowerCase() as StellarNetwork
    if (network?.networkPassphrase) return parseStellarNetworkPassphrase(network.networkPassphrase)
    return null
  } catch {
    return null
  }
}

export async function detectWalletNetwork(walletType?: string): Promise<StellarNetwork | null> {
  if (walletType === 'freighter' || !walletType) {
    const freighter = await detectFreighterNetwork()
    if (freighter) return freighter
  }
  if (walletType === 'rabet' || !walletType) {
    const rabet = await detectRabetNetwork()
    if (rabet) return rabet
  }
  if (walletType === 'xbull' || !walletType) {
    const xbull = await detectXbullNetwork()
    if (xbull) return xbull
  }
  return null
}
