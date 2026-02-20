declare global {
    interface Window {
        freighter?: {
            requestAccess(): Promise<{ publicKey: string }>
            signTransaction(xdr: string, options?: any): Promise<{ signedTxXdr: string }>
            isConnected(): Promise<boolean>
        }
        rabet?: {
            connect(): Promise<{ publicKey: string }>
            sign(xdr: string, network?: string): Promise<{ signedXDR: string }>
            isConnected(): Promise<boolean>
        }
        xBull?: {
            connect(): Promise<{ publicKey: string }>
            signTransaction(xdr: string): Promise<{ signedXDR: string }>
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
