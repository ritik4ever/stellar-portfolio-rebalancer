import { WalletAdapter, WalletType, getAdapter, getAvailableAdapters, WalletError } from './walletAdapters'

const STORAGE_KEY_WALLET_TYPE = 'wallet_type'
const STORAGE_KEY_PUBLIC_KEY = 'stellar_public_key'
const STORAGE_KEY_WALLET_CONNECTED = 'wallet_connected'

export class WalletManager {
    private currentAdapter: WalletAdapter | null = null
    private currentPublicKey: string | null = null

    async connect(walletType: WalletType): Promise<string> {
        const adapter = getAdapter(walletType)
        if (!adapter) {
            throw new WalletError(`Wallet adapter not found: ${walletType}`, 'ADAPTER_NOT_FOUND', walletType)
        }

        if (!adapter.isAvailable()) {
            throw new WalletError(`${adapter.name} wallet is not installed`, 'WALLET_NOT_INSTALLED', walletType)
        }

        try {
            const publicKey = await adapter.connect()
            this.currentAdapter = adapter
            this.currentPublicKey = publicKey

            localStorage.setItem(STORAGE_KEY_WALLET_TYPE, walletType)
            localStorage.setItem(STORAGE_KEY_PUBLIC_KEY, publicKey)
            localStorage.setItem(STORAGE_KEY_WALLET_CONNECTED, 'true')

            return publicKey
        } catch (error) {
            this.clearStorage()
            throw error
        }
    }

    async reconnect(): Promise<string | null> {
        const savedType = localStorage.getItem(STORAGE_KEY_WALLET_TYPE) as WalletType | null
        const savedPublicKey = localStorage.getItem(STORAGE_KEY_PUBLIC_KEY)

        if (!savedType || !savedPublicKey) {
            return null
        }

        const adapter = getAdapter(savedType)
        if (!adapter || !adapter.isAvailable()) {
            this.clearStorage()
            return null
        }

        try {
            const isConnected = await adapter.isConnected()
            if (!isConnected) {
                this.clearStorage()
                return null
            }

            this.currentAdapter = adapter
            this.currentPublicKey = savedPublicKey
            return savedPublicKey
        } catch {
            this.clearStorage()
            return null
        }
    }

    async isConnected(): Promise<boolean> {
        if (!this.currentAdapter || !this.currentPublicKey) {
            return false
        }

        try {
            return await this.currentAdapter.isConnected()
        } catch {
            return false
        }
    }

    getPublicKey(): string | null {
        return this.currentPublicKey || localStorage.getItem(STORAGE_KEY_PUBLIC_KEY)
    }

    getWalletType(): WalletType | null {
        return (this.currentAdapter?.type as WalletType) || (localStorage.getItem(STORAGE_KEY_WALLET_TYPE) as WalletType | null)
    }

    async disconnect(): Promise<void> {
        this.currentAdapter = null
        this.currentPublicKey = null
        this.clearStorage()
    }

    async signTransaction(xdr: string, network?: string): Promise<string> {
        if (!this.currentAdapter) {
            throw new WalletError('No wallet connected', 'NOT_CONNECTED')
        }

        return this.currentAdapter.signTransaction(xdr, network)
    }

    getAvailableWallets() {
        return getAvailableAdapters()
    }

    private clearStorage(): void {
        localStorage.removeItem(STORAGE_KEY_WALLET_TYPE)
        localStorage.removeItem(STORAGE_KEY_PUBLIC_KEY)
        localStorage.removeItem(STORAGE_KEY_WALLET_CONNECTED)
    }
}

export const walletManager = new WalletManager()
