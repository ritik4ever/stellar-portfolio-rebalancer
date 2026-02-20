export type WalletType = 'freighter' | 'rabet' | 'xbull'

export interface WalletAdapter {
    readonly name: string
    readonly type: WalletType
    isAvailable(): boolean
    connect(): Promise<string>
    isConnected(): Promise<boolean>
    disconnect(): Promise<void>
    signTransaction(xdr: string, network?: string): Promise<string>
}

export class WalletError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly walletType?: WalletType
    ) {
        super(message)
        this.name = 'WalletError'
    }
}

function normalizeError(error: unknown, walletType: WalletType): WalletError {
    const err = error instanceof Error ? error : new Error(String(error))
    const msg = err.message.toLowerCase()

    if (msg.includes('user') && (msg.includes('declined') || msg.includes('rejected') || msg.includes('cancel'))) {
        return new WalletError('Connection was declined by user', 'USER_DECLINED', walletType)
    }

    if (msg.includes('not installed') || msg.includes('not found') || msg.includes('unavailable')) {
        return new WalletError(`${walletType} wallet is not installed`, 'WALLET_NOT_INSTALLED', walletType)
    }

    if (msg.includes('network') || msg.includes('networkpassphrase')) {
        return new WalletError('Network mismatch. Please check your wallet network settings', 'NETWORK_MISMATCH', walletType)
    }

    if (msg.includes('timeout') || msg.includes('timed out')) {
        return new WalletError('Connection timed out. Please try again', 'TIMEOUT', walletType)
    }

    return new WalletError(err.message || 'Wallet connection failed', 'UNKNOWN_ERROR', walletType)
}

export class FreighterAdapter implements WalletAdapter {
    readonly name = 'Freighter'
    readonly type: WalletType = 'freighter'

    isAvailable(): boolean {
        return typeof window !== 'undefined' && !!window.freighter
    }

    async connect(): Promise<string> {
        if (!this.isAvailable()) {
            throw new WalletError('Freighter wallet is not installed', 'WALLET_NOT_INSTALLED', this.type)
        }

        try {
            const result = await window.freighter!.requestAccess()
            if (!result?.publicKey) {
                throw new Error('No public key returned')
            }
            return result.publicKey
        } catch (error) {
            throw normalizeError(error, this.type)
        }
    }

    async isConnected(): Promise<boolean> {
        if (!this.isAvailable()) return false
        try {
            return await window.freighter!.isConnected()
        } catch {
            return false
        }
    }

    async disconnect(): Promise<void> {
    }

    async signTransaction(xdr: string, network?: string): Promise<string> {
        if (!this.isAvailable()) {
            throw new WalletError('Freighter wallet is not installed', 'WALLET_NOT_INSTALLED', this.type)
        }

        try {
            const result = await window.freighter!.signTransaction(xdr, { network })
            if (!result?.signedTxXdr) {
                throw new Error('No signed transaction returned')
            }
            return result.signedTxXdr
        } catch (error) {
            throw normalizeError(error, this.type)
        }
    }
}

export class RabetAdapter implements WalletAdapter {
    readonly name = 'Rabet'
    readonly type: WalletType = 'rabet'

    isAvailable(): boolean {
        return typeof window !== 'undefined' && !!window.rabet
    }

    async connect(): Promise<string> {
        if (!this.isAvailable()) {
            throw new WalletError('Rabet wallet is not installed', 'WALLET_NOT_INSTALLED', this.type)
        }

        try {
            const result = await window.rabet!.connect()
            if (!result?.publicKey) {
                throw new Error('No public key returned')
            }
            return result.publicKey
        } catch (error) {
            throw normalizeError(error, this.type)
        }
    }

    async isConnected(): Promise<boolean> {
        if (!this.isAvailable()) return false
        try {
            return await window.rabet!.isConnected()
        } catch {
            return false
        }
    }

    async disconnect(): Promise<void> {
    }

    async signTransaction(xdr: string, network?: string): Promise<string> {
        if (!this.isAvailable()) {
            throw new WalletError('Rabet wallet is not installed', 'WALLET_NOT_INSTALLED', this.type)
        }

        try {
            const result = await window.rabet!.sign(xdr, network)
            if (!result?.signedXDR) {
                throw new Error('No signed transaction returned')
            }
            return result.signedXDR
        } catch (error) {
            throw normalizeError(error, this.type)
        }
    }
}

export class XBullAdapter implements WalletAdapter {
    readonly name = 'xBull'
    readonly type: WalletType = 'xbull'

    isAvailable(): boolean {
        return typeof window !== 'undefined' && !!window.xBull
    }

    async connect(): Promise<string> {
        if (!this.isAvailable()) {
            throw new WalletError('xBull wallet is not installed', 'WALLET_NOT_INSTALLED', this.type)
        }

        try {
            const result = await window.xBull!.connect()
            if (!result?.publicKey) {
                throw new Error('No public key returned')
            }
            return result.publicKey
        } catch (error) {
            throw normalizeError(error, this.type)
        }
    }

    async isConnected(): Promise<boolean> {
        return this.isAvailable() && localStorage.getItem('wallet_type') === 'xbull'
    }

    async disconnect(): Promise<void> {
    }

    async signTransaction(xdr: string): Promise<string> {
        if (!this.isAvailable()) {
            throw new WalletError('xBull wallet is not installed', 'WALLET_NOT_INSTALLED', this.type)
        }

        try {
            const result = await window.xBull!.signTransaction(xdr)
            if (!result?.signedXDR) {
                throw new Error('No signed transaction returned')
            }
            return result.signedXDR
        } catch (error) {
            throw normalizeError(error, this.type)
        }
    }
}

export const walletAdapters: WalletAdapter[] = [
    new FreighterAdapter(),
    new RabetAdapter(),
    new XBullAdapter()
]

export function getAdapter(type: WalletType): WalletAdapter | null {
    return walletAdapters.find(a => a.type === type) || null
}

export function getAvailableAdapters(): WalletAdapter[] {
    return walletAdapters.filter(a => a.isAvailable())
}
