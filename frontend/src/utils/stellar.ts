declare global {
    interface Window {
        freighter?: {
            requestAccess(): Promise<{ publicKey: string }>
            signTransaction(xdr: string, options?: any): Promise<{ signedTxXdr: string }>
            isConnected(): Promise<boolean>
            getNetworkDetails(): Promise<{ network: string; networkPassphrase: string }>
        }
        rabet?: {
            connect(): Promise<{ publicKey: string }>
            sign(xdr: string, network?: string): Promise<{ signedXDR: string }>
            isConnected(): Promise<boolean>
            getNetwork(): Promise<string | { network: string; networkPassphrase?: string }>
        }
        xBull?: {
            connect(): Promise<{ publicKey: string }>
            signTransaction(xdr: string): Promise<{ signedXDR: string }>
            getNetwork(): Promise<string | { network: string; networkPassphrase?: string }>
        }
        hana?: {
            requestAccess?: () => Promise<{ publicKey?: string } | string>
            connect?: () => Promise<{ publicKey?: string; address?: string } | string>
            getAddress?: () => Promise<{ address?: string; publicKey?: string } | string>
            isConnected?: () => Promise<boolean>
            disconnect?: () => Promise<void>
            signTransaction?: (
                xdr: string,
                options?: { network?: string; networkPassphrase?: string }
            ) => Promise<{ signedTxXdr?: string; signedXDR?: string } | string>
            getNetwork?: () => Promise<string | { network: string; networkPassphrase?: string }>
        }
        stellar?: {
            provider?: string
            platform?: string
            requestAccess?: () => Promise<{ publicKey?: string } | string>
            connect?: () => Promise<{ publicKey?: string; address?: string } | string>
            getAddress?: () => Promise<{ address?: string; publicKey?: string } | string>
            isConnected?: () => Promise<boolean>
            disconnect?: () => Promise<void>
            signTransaction?: (
                xdr: string,
                options?: { network?: string; networkPassphrase?: string }
            ) => Promise<{ signedTxXdr?: string; signedXDR?: string } | string>
        }
        lobstr?: {
            requestAccess(): Promise<{ publicKey: string }>
            signTransaction(xdr: string, opts?: { networkPassphrase?: string }): Promise<string>
            isConnected(): Promise<boolean>
        }
    }
}

import { walletManager } from './walletManager.js'
import { WalletType } from './walletAdapters.js'

export class StellarWallet {
    static async isWalletAvailable(): Promise<{ wallet: string; available: boolean }> {
        const adapters = walletManager.getAvailableWallets()
        if (adapters.length > 0) {
            return { wallet: adapters[0].type, available: true }
        }
        return { wallet: 'none', available: false }
    }

    static async connectWallet(walletType?: WalletType): Promise<string> {
        if (!walletType) {
            throw new Error('Wallet type must be explicitly specified. Use WalletSelector to choose a wallet.')
        }
        return walletManager.connect(walletType)
    }

    static async isConnected(): Promise<boolean> {
        return walletManager.isConnected()
    }

    static getPublicKey(): string | null {
        return walletManager.getPublicKey()
    }

    static getWalletType(): string | null {
        return walletManager.getWalletType()
    }

    static disconnect(): void {
        walletManager.disconnect()
    }
}
