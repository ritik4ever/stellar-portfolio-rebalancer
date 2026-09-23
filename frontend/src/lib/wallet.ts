export type SupportedWallet = 'freighter' | 'rabet' | 'xbull' | 'hana' | 'lobstr' | 'walletconnect'

export interface WalletInfo {
  name: string
  type: SupportedWallet
  icon?: string
  installUrl: string
}

export const SUPPORTED_WALLETS: WalletInfo[] = [
  { name: 'Freighter', type: 'freighter', installUrl: 'https://www.freighter.app/' },
  { name: 'Rabet', type: 'rabet', installUrl: 'https://rabet.io/' },
  { name: 'xBull', type: 'xbull', installUrl: 'https://xbull.app/' },
  { name: 'Hana', type: 'hana', installUrl: 'https://www.hanawallet.io/' },
  { name: 'LOBSTR', type: 'lobstr', installUrl: 'https://lobstr.co/' },
  { name: 'WalletConnect', type: 'walletconnect', installUrl: 'https://walletconnect.com/' },
]

export function getLastUsedWallet(): SupportedWallet | null {
  return localStorage.getItem('last_used_wallet') as SupportedWallet | null
}

export function setLastUsedWallet(wallet: SupportedWallet): void {
  localStorage.setItem('last_used_wallet', wallet)
}

export function clearLastUsedWallet(): void {
  localStorage.removeItem('last_used_wallet')
}
