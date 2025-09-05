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

export class StellarWallet {
    static async isWalletAvailable(): Promise<{ wallet: string; available: boolean }> {
        // Check for wallets with retry mechanism
        return new Promise((resolve) => {
            const checkWallets = () => {
                if (window.rabet) {
                    resolve({ wallet: 'rabet', available: true })
                } else if (window.freighter) {
                    resolve({ wallet: 'freighter', available: true })
                } else if (window.xBull) {
                    resolve({ wallet: 'xbull', available: true })
                } else {
                    resolve({ wallet: 'none', available: false })
                }
            }

            // Check immediately
            checkWallets()

            // Also check after a short delay for slow-loading extensions
            setTimeout(checkWallets, 1000)
        })
    }

    static async connectWallet(): Promise<string> {
        const { wallet, available } = await this.isWalletAvailable()

        if (!available) {
            throw new Error('NO_WALLET_FOUND')
        }

        try {
            let publicKey: string

            if (wallet === 'rabet' && window.rabet) {
                const result = await window.rabet.connect()
                publicKey = result.publicKey
                localStorage.setItem('wallet_type', 'rabet')
            } else if (wallet === 'freighter' && window.freighter) {
                const result = await window.freighter.requestAccess()
                publicKey = result.publicKey
                localStorage.setItem('wallet_type', 'freighter')
            } else if (wallet === 'xbull' && window.xBull) {
                const result = await window.xBull.connect()
                publicKey = result.publicKey
                localStorage.setItem('wallet_type', 'xbull')
            } else {
                throw new Error('No supported wallet found')
            }

            if (!publicKey) {
                throw new Error('Failed to get public key from wallet')
            }

            localStorage.setItem('stellar_public_key', publicKey)
            localStorage.setItem('wallet_connected', 'true')

            return publicKey
        } catch (error: any) {
            console.error('Wallet connection failed:', error)

            if (error.message?.includes('User declined') || error.message?.includes('rejected')) {
                throw new Error('User declined wallet access')
            }

            throw new Error(`Failed to connect to ${wallet} wallet: ${error.message}`)
        }
    }

    static async isConnected(): Promise<boolean> {
        const connected = localStorage.getItem('wallet_connected')
        const publicKey = localStorage.getItem('stellar_public_key')
        const walletType = localStorage.getItem('wallet_type')

        if (!connected || !publicKey || !walletType) return false

        try {
            if (walletType === 'rabet' && window.rabet) {
                return await window.rabet.isConnected()
            } else if (walletType === 'freighter' && window.freighter) {
                return await window.freighter.isConnected()
            }
            return false
        } catch {
            return false
        }
    }

    static getPublicKey(): string | null {
        return localStorage.getItem('stellar_public_key')
    }

    static getWalletType(): string | null {
        return localStorage.getItem('wallet_type')
    }

    static disconnect(): void {
        localStorage.removeItem('stellar_public_key')
        localStorage.removeItem('wallet_connected')
        localStorage.removeItem('wallet_type')
    }
}