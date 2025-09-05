import {
    Horizon,
    Asset,
    Operation,
    TransactionBuilder,
    Networks,
    Keypair,
    Memo
} from '@stellar/stellar-sdk'

export class StellarDEXService {
    private server: Horizon.Server

    constructor() {
        this.server = new Horizon.Server('https://horizon-testnet.stellar.org')
    }

    async executeRebalanceTrades(
        userAddress: string,
        trades: Array<{ asset: string, action: 'buy' | 'sell', amount: number, targetAsset?: string }>
    ): Promise<any> {
        try {
            const account = await this.server.loadAccount(userAddress)
            const fee = await this.server.fetchBaseFee()

            const transactionBuilder = new TransactionBuilder(account, {
                fee: fee.toString(),
                networkPassphrase: Networks.TESTNET
            })

            for (const trade of trades) {
                if (trade.action === 'sell') {
                    // Create sell offer
                    const sellAsset = this.getAssetObject(trade.asset)
                    const buyAsset = this.getAssetObject(trade.targetAsset || 'XLM')

                    // Get current market price for offer
                    const orderbook = await this.server.orderbook(sellAsset, buyAsset).call()
                    const marketPrice = this.calculateMarketPrice(orderbook)

                    transactionBuilder.addOperation(
                        Operation.manageSellOffer({
                            selling: sellAsset,
                            buying: buyAsset,
                            amount: trade.amount.toFixed(7),
                            price: marketPrice.toString(),
                            offerId: '0' // Creates new offer
                        })
                    )
                } else {
                    // Create buy offer
                    const buyAsset = this.getAssetObject(trade.asset)
                    const sellAsset = this.getAssetObject(trade.targetAsset || 'XLM')

                    const orderbook = await this.server.orderbook(sellAsset, buyAsset).call()
                    const marketPrice = this.calculateMarketPrice(orderbook)

                    transactionBuilder.addOperation(
                        Operation.manageBuyOffer({
                            selling: sellAsset,
                            buying: buyAsset,
                            buyAmount: trade.amount.toFixed(7),
                            price: marketPrice.toString(),
                            offerId: '0'
                        })
                    )
                }
            }

            transactionBuilder.addMemo(Memo.text('Portfolio Rebalance'))
            transactionBuilder.setTimeout(300)

            const transaction = transactionBuilder.build()

            // Return unsigned transaction for frontend to sign
            return {
                xdr: transaction.toXDR(),
                trades: trades.length,
                estimatedFee: (fee * trades.length) / 10000000 // Convert to XLM
            }

        } catch (error) {
            console.error('DEX trade execution failed:', error)
            throw new Error(`Failed to execute trades: ${error}`)
        }
    }

    private getAssetObject(assetCode: string): Asset {
        if (assetCode === 'XLM') {
            return Asset.native()
        }

        // Define known test assets
        const assetMap: Record<string, { code: string, issuer: string }> = {
            'USDC': {
                code: 'USDC',
                issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
            },
            'BTC': {
                code: 'BTC',
                issuer: 'GAUTUYY2THLF7SGITDFMXJVYH3LHDSMGEAKSBU267M2K7A3W543CKUEF'
            }
        }

        if (assetMap[assetCode]) {
            return new Asset(assetMap[assetCode].code, assetMap[assetCode].issuer)
        }

        throw new Error(`Unsupported asset: ${assetCode}`)
    }

    private calculateMarketPrice(orderbook: any): number {
        // Calculate market price from orderbook
        if (orderbook.bids.length > 0 && orderbook.asks.length > 0) {
            const bestBid = parseFloat(orderbook.bids[0].price)
            const bestAsk = parseFloat(orderbook.asks[0].price)
            return (bestBid + bestAsk) / 2
        }
        return 1.0 // Fallback price
    }

    async getMarketData(baseAsset: string, counterAsset: string): Promise<any> {
        try {
            const base = this.getAssetObject(baseAsset)
            const counter = this.getAssetObject(counterAsset)

            const orderbook = await this.server.orderbook(base, counter).call()
            const trades = await this.server.trades()
                .forAssetPair(base, counter)
                .limit(10)
                .call()

            return {
                spread: this.calculateSpread(orderbook),
                volume24h: this.calculate24hVolume(trades.records),
                lastPrice: trades.records[0]?.price || null
            }
        } catch (error) {
            console.error('Failed to get market data:', error)
            return null
        }
    }

    private calculateSpread(orderbook: any): number {
        if (orderbook.bids.length > 0 && orderbook.asks.length > 0) {
            const bestBid = parseFloat(orderbook.bids[0].price)
            const bestAsk = parseFloat(orderbook.asks[0].price)
            return ((bestAsk - bestBid) / bestAsk) * 100
        }
        return 0
    }

    private calculate24hVolume(trades: any[]): number {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000)
        return trades
            .filter(trade => new Date(trade.ledger_close_time).getTime() > oneDayAgo)
            .reduce((sum, trade) => sum + parseFloat(trade.base_amount), 0)
    }
}