import {
    Horizon,
    Asset,
    Operation,
    TransactionBuilder,
    Networks,
    Keypair,
    Memo
} from '@stellar/stellar-sdk'

export interface DEXTradeRequest {
    tradeId: string
    fromAsset: string
    toAsset: string
    amount: number
    maxSlippageBps?: number
}

export interface RebalanceExecutionConfig {
    maxSlippageBpsPerTrade: number
    maxSlippageBpsPerRebalance: number
    maxSpreadBps: number
    minLiquidityCoverage: number
    allowPartialFill: boolean
    rollbackOnFailure: boolean
    signerSecret?: string
}

export interface DEXTradeExecutionResult {
    tradeId: string
    fromAsset: string
    toAsset: string
    requestedAmount: number
    executedAmount: number
    estimatedReceivedAmount: number
    remainingAmount: number
    referencePrice: number
    priceLimit: number
    spreadBps: number
    slippageBps: number
    liquidityCoverage: number
    status: 'executed' | 'partial' | 'failed' | 'skipped'
    txHash?: string
    rollbackTxHash?: string
    rolledBack?: boolean
    failureReason?: string
}

export interface DEXRollbackResult {
    attempted: boolean
    success: boolean
    rolledBackTrades: number
    failures: string[]
}

export interface DEXRebalanceExecutionResult {
    status: 'success' | 'partial' | 'failed'
    executedTrades: DEXTradeExecutionResult[]
    partialFills: DEXTradeExecutionResult[]
    failedTrades: DEXTradeExecutionResult[]
    totalEstimatedFeeXLM: number
    totalSlippageBps: number
    rollback: DEXRollbackResult
    failureReason?: string
}

interface MarketAssessment {
    referencePrice: number
    spreadBps: number
    liquidityCoverage: number
}

interface RawOfferAsset {
    asset_type: string
    asset_code?: string
    asset_issuer?: string
}

interface RawOfferRecord {
    id: string | number
    amount: string
    price: string
    selling: RawOfferAsset
    buying: RawOfferAsset
}

export class StellarDEXService {
    private server: Horizon.Server
    private networkPassphrase: string
    private assetIssuers: Record<string, string>

    constructor() {
        const network = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase()
        const horizonUrl = process.env.STELLAR_HORIZON_URL
            || (network === 'mainnet'
                ? 'https://horizon.stellar.org'
                : 'https://horizon-testnet.stellar.org')

        this.server = new Horizon.Server(horizonUrl)
        this.networkPassphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET
        this.assetIssuers = this.loadAssetIssuers()
    }

    getDefaultExecutionConfig(): RebalanceExecutionConfig {
        return {
            maxSlippageBpsPerTrade: this.readNumberEnv('REBALANCE_MAX_TRADE_SLIPPAGE_BPS', 100, 1, 5000),
            maxSlippageBpsPerRebalance: this.readNumberEnv('REBALANCE_MAX_TOTAL_SLIPPAGE_BPS', 250, 1, 10000),
            maxSpreadBps: this.readNumberEnv('REBALANCE_MAX_SPREAD_BPS', 120, 1, 10000),
            minLiquidityCoverage: this.readNumberEnv('REBALANCE_MIN_LIQUIDITY_COVERAGE', 1, 0.1, 100),
            allowPartialFill: this.readBooleanEnv('REBALANCE_ALLOW_PARTIAL_FILL', true),
            rollbackOnFailure: this.readBooleanEnv('REBALANCE_ROLLBACK_ON_FAILURE', true)
        }
    }

    async executeRebalanceTrades(
        userAddress: string,
        trades: DEXTradeRequest[],
        requestedConfig: Partial<RebalanceExecutionConfig> = {}
    ): Promise<DEXRebalanceExecutionResult> {
        const config = {
            ...this.getDefaultExecutionConfig(),
            ...requestedConfig
        }

        const rollback: DEXRollbackResult = {
            attempted: false,
            success: true,
            rolledBackTrades: 0,
            failures: []
        }

        const signer = this.resolveSigner(userAddress, config.signerSecret)
        const fee = await this.server.fetchBaseFee()

        const executedTrades: DEXTradeExecutionResult[] = []
        const failedTrades: DEXTradeExecutionResult[] = []
        const partialFills: DEXTradeExecutionResult[] = []

        let slippageWeightedSum = 0
        let slippageWeight = 0
        let totalEstimatedFeeXLM = 0

        for (const trade of trades) {
            const effectiveTradeSlippage = this.getEffectiveTradeSlippage(config, trade.maxSlippageBps)
            const tradeResult = await this.executeSingleTrade(
                signer,
                trade,
                effectiveTradeSlippage,
                config.maxSpreadBps,
                config.minLiquidityCoverage,
                fee
            )

            totalEstimatedFeeXLM += fee / 10000000

            if (tradeResult.status === 'failed') {
                failedTrades.push(tradeResult)
                break
            }

            executedTrades.push(tradeResult)
            if (tradeResult.status === 'partial') {
                partialFills.push(tradeResult)
                if (!config.allowPartialFill) {
                    failedTrades.push({
                        ...tradeResult,
                        status: 'failed',
                        failureReason: 'Partial fill is not allowed by rebalance configuration'
                    })
                    break
                }
            }

            if (tradeResult.executedAmount > 0) {
                const tradeNotional = tradeResult.executedAmount * tradeResult.referencePrice
                const measuredSlippage = tradeResult.slippageBps > 0 ? tradeResult.slippageBps : effectiveTradeSlippage
                slippageWeightedSum += measuredSlippage * tradeNotional
                slippageWeight += tradeNotional
            }

            const cumulativeSlippageBps = slippageWeight > 0 ? (slippageWeightedSum / slippageWeight) : 0
            if (cumulativeSlippageBps > config.maxSlippageBpsPerRebalance) {
                failedTrades.push({
                    tradeId: trade.tradeId,
                    fromAsset: trade.fromAsset,
                    toAsset: trade.toAsset,
                    requestedAmount: trade.amount,
                    executedAmount: 0,
                    estimatedReceivedAmount: 0,
                    remainingAmount: trade.amount,
                    referencePrice: tradeResult.referencePrice,
                    priceLimit: tradeResult.priceLimit,
                    spreadBps: tradeResult.spreadBps,
                    slippageBps: cumulativeSlippageBps,
                    liquidityCoverage: tradeResult.liquidityCoverage,
                    status: 'failed',
                    failureReason: `Rebalance slippage ${cumulativeSlippageBps.toFixed(2)} bps exceeds max ${config.maxSlippageBpsPerRebalance} bps`
                })
                break
            }
        }

        let status: DEXRebalanceExecutionResult['status'] = 'success'
        let failureReason: string | undefined

        if (failedTrades.length > 0) {
            status = 'failed'
            failureReason = failedTrades[0].failureReason || 'Trade execution failed'
        } else if (partialFills.length > 0) {
            status = 'partial'
        }

        if (status === 'failed' && config.rollbackOnFailure && executedTrades.some(t => t.executedAmount > 0)) {
            rollback.attempted = true
            const rollbackResult = await this.rollbackExecutedTrades(signer, [...executedTrades].reverse(), config, fee)
            rollback.success = rollbackResult.success
            rollback.rolledBackTrades = rollbackResult.rolledBackTrades
            rollback.failures = rollbackResult.failures
        }

        return {
            status,
            executedTrades,
            partialFills,
            failedTrades,
            totalEstimatedFeeXLM,
            totalSlippageBps: slippageWeight > 0 ? (slippageWeightedSum / slippageWeight) : 0,
            rollback,
            failureReason
        }
    }

    private async executeSingleTrade(
        signer: Keypair,
        trade: DEXTradeRequest,
        maxSlippageBps: number,
        maxSpreadBps: number,
        minLiquidityCoverage: number,
        baseFee: number
    ): Promise<DEXTradeExecutionResult> {
        const requestedAmount = this.roundAmount(trade.amount)
        let fromAsset: Asset
        let toAsset: Asset

        try {
            fromAsset = this.getAssetObject(trade.fromAsset)
            toAsset = this.getAssetObject(trade.toAsset)
        } catch (error) {
            return {
                tradeId: trade.tradeId,
                fromAsset: trade.fromAsset,
                toAsset: trade.toAsset,
                requestedAmount,
                executedAmount: 0,
                estimatedReceivedAmount: 0,
                remainingAmount: requestedAmount,
                referencePrice: 0,
                priceLimit: 0,
                spreadBps: 0,
                slippageBps: 0,
                liquidityCoverage: 0,
                status: 'failed',
                failureReason: this.getErrorMessage(error)
            }
        }

        if (requestedAmount <= 0) {
            return {
                tradeId: trade.tradeId,
                fromAsset: trade.fromAsset,
                toAsset: trade.toAsset,
                requestedAmount,
                executedAmount: 0,
                estimatedReceivedAmount: 0,
                remainingAmount: requestedAmount,
                referencePrice: 0,
                priceLimit: 0,
                spreadBps: 0,
                slippageBps: 0,
                liquidityCoverage: 0,
                status: 'failed',
                failureReason: 'Trade amount must be greater than zero'
            }
        }

        const market = await this.assessMarket(fromAsset, toAsset, requestedAmount)
        if (market.spreadBps > maxSpreadBps) {
            return {
                tradeId: trade.tradeId,
                fromAsset: trade.fromAsset,
                toAsset: trade.toAsset,
                requestedAmount,
                executedAmount: 0,
                estimatedReceivedAmount: 0,
                remainingAmount: requestedAmount,
                referencePrice: market.referencePrice,
                priceLimit: market.referencePrice,
                spreadBps: market.spreadBps,
                slippageBps: 0,
                liquidityCoverage: market.liquidityCoverage,
                status: 'failed',
                failureReason: `Spread ${market.spreadBps.toFixed(2)} bps exceeds max ${maxSpreadBps} bps`
            }
        }

        if (market.liquidityCoverage < minLiquidityCoverage) {
            return {
                tradeId: trade.tradeId,
                fromAsset: trade.fromAsset,
                toAsset: trade.toAsset,
                requestedAmount,
                executedAmount: 0,
                estimatedReceivedAmount: 0,
                remainingAmount: requestedAmount,
                referencePrice: market.referencePrice,
                priceLimit: market.referencePrice,
                spreadBps: market.spreadBps,
                slippageBps: 0,
                liquidityCoverage: market.liquidityCoverage,
                status: 'failed',
                failureReason: `Liquidity coverage ${market.liquidityCoverage.toFixed(2)}x below required ${minLiquidityCoverage}x`
            }
        }

        const priceLimit = market.referencePrice * (1 - (maxSlippageBps / 10000))
        if (!Number.isFinite(priceLimit) || priceLimit <= 0) {
            return {
                tradeId: trade.tradeId,
                fromAsset: trade.fromAsset,
                toAsset: trade.toAsset,
                requestedAmount,
                executedAmount: 0,
                estimatedReceivedAmount: 0,
                remainingAmount: requestedAmount,
                referencePrice: market.referencePrice,
                priceLimit: 0,
                spreadBps: market.spreadBps,
                slippageBps: 0,
                liquidityCoverage: market.liquidityCoverage,
                status: 'failed',
                failureReason: 'Invalid limit price computed for trade'
            }
        }

        try {
            const accountId = signer.publicKey()
            const offersBefore = await this.getOpenOffersById(accountId)
            const account = await this.server.loadAccount(accountId)
            const txBuilder = new TransactionBuilder(account, {
                fee: baseFee.toString(),
                networkPassphrase: this.networkPassphrase
            })

            txBuilder.addOperation(
                Operation.manageSellOffer({
                    selling: fromAsset,
                    buying: toAsset,
                    amount: this.amountToString(requestedAmount),
                    price: priceLimit.toFixed(7),
                    offerId: '0'
                })
            )
            txBuilder.addMemo(Memo.text(this.buildTradeMemo(trade.tradeId)))
            txBuilder.setTimeout(60)

            const tx = txBuilder.build()
            tx.sign(signer)

            const submitResponse = await this.server.submitTransaction(tx)
            const txHash = submitResponse.hash

            let offersAfter = await this.getOpenOffersById(accountId)
            let newOffer = this.findNewOffer(offersBefore, offersAfter, fromAsset, toAsset)
            if (!newOffer) {
                await this.delay(250)
                offersAfter = await this.getOpenOffersById(accountId)
                newOffer = this.findNewOffer(offersBefore, offersAfter, fromAsset, toAsset)
            }

            let remainingAmount = 0
            if (newOffer) {
                remainingAmount = this.roundAmount(parseFloat(newOffer.amount))
                if (remainingAmount > 0) {
                    await this.cancelOffer(signer, newOffer, fromAsset, toAsset, baseFee)
                }
            }

            const executedAmount = this.roundAmount(Math.max(0, requestedAmount - remainingAmount))
            const status: DEXTradeExecutionResult['status'] =
                executedAmount <= 0 ? 'failed' : remainingAmount > 0 ? 'partial' : 'executed'

            const observedPrice = await this.tryGetAverageTradePrice(txHash)
            const executionPrice = observedPrice && observedPrice > 0 ? observedPrice : market.referencePrice
            const estimatedReceivedAmount = this.roundAmount(executedAmount * executionPrice)
            const slippageBps = market.referencePrice > 0
                ? Math.max(0, ((market.referencePrice - executionPrice) / market.referencePrice) * 10000)
                : 0

            return {
                tradeId: trade.tradeId,
                fromAsset: trade.fromAsset,
                toAsset: trade.toAsset,
                requestedAmount,
                executedAmount,
                estimatedReceivedAmount,
                remainingAmount,
                referencePrice: market.referencePrice,
                priceLimit,
                spreadBps: market.spreadBps,
                slippageBps,
                liquidityCoverage: market.liquidityCoverage,
                status,
                txHash,
                failureReason: status === 'failed' ? 'Offer placed but no fill received' : undefined
            }
        } catch (error) {
            return {
                tradeId: trade.tradeId,
                fromAsset: trade.fromAsset,
                toAsset: trade.toAsset,
                requestedAmount,
                executedAmount: 0,
                estimatedReceivedAmount: 0,
                remainingAmount: requestedAmount,
                referencePrice: market.referencePrice,
                priceLimit,
                spreadBps: market.spreadBps,
                slippageBps: 0,
                liquidityCoverage: market.liquidityCoverage,
                status: 'failed',
                failureReason: this.getErrorMessage(error)
            }
        }
    }

    private async rollbackExecutedTrades(
        signer: Keypair,
        executedTrades: DEXTradeExecutionResult[],
        config: RebalanceExecutionConfig,
        baseFee: number
    ): Promise<DEXRollbackResult> {
        const result: DEXRollbackResult = {
            attempted: true,
            success: true,
            rolledBackTrades: 0,
            failures: []
        }

        for (const trade of executedTrades) {
            if (trade.executedAmount <= 0 || trade.estimatedReceivedAmount <= 0) {
                continue
            }

            const rollbackTrade: DEXTradeRequest = {
                tradeId: `rollback-${trade.tradeId}`,
                fromAsset: trade.toAsset,
                toAsset: trade.fromAsset,
                amount: trade.estimatedReceivedAmount,
                maxSlippageBps: trade.slippageBps > 0 ? Math.ceil(trade.slippageBps) : config.maxSlippageBpsPerTrade
            }

            const rollbackExec = await this.executeSingleTrade(
                signer,
                rollbackTrade,
                this.getEffectiveTradeSlippage(config, rollbackTrade.maxSlippageBps),
                config.maxSpreadBps,
                config.minLiquidityCoverage,
                baseFee
            )

            if (rollbackExec.status === 'executed' || rollbackExec.status === 'partial') {
                trade.rolledBack = true
                trade.rollbackTxHash = rollbackExec.txHash
                result.rolledBackTrades += 1
            } else {
                result.success = false
                result.failures.push(
                    `Rollback failed for ${trade.tradeId}: ${rollbackExec.failureReason || 'unknown error'}`
                )
            }
        }

        return result
    }

    private async assessMarket(
        fromAsset: Asset,
        toAsset: Asset,
        amount: number
    ): Promise<MarketAssessment> {
        const orderbook = await this.server.orderbook(fromAsset, toAsset).call()
        const bids = Array.isArray((orderbook as any).bids) ? (orderbook as any).bids as Array<{ price: string, amount: string }> : []
        const asks = Array.isArray((orderbook as any).asks) ? (orderbook as any).asks as Array<{ price: string, amount: string }> : []

        const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : 0
        const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : 0

        if (bestBid <= 0) {
            return {
                referencePrice: bestAsk > 0 ? bestAsk : 0,
                spreadBps: Number.POSITIVE_INFINITY,
                liquidityCoverage: 0
            }
        }

        const availableLiquidity = bids.reduce((sum, bid) => sum + parseFloat(bid.amount || '0'), 0)
        const spreadBps = (bestAsk > 0 && bestBid > 0)
            ? ((bestAsk - bestBid) / bestAsk) * 10000
            : 0

        return {
            referencePrice: bestBid,
            spreadBps,
            liquidityCoverage: availableLiquidity / amount
        }
    }

    private async getOpenOffersById(accountId: string): Promise<Map<string, RawOfferRecord>> {
        const map = new Map<string, RawOfferRecord>()
        const offersPage = await this.server.offers().forAccount(accountId).limit(200).call() as any
        const records = Array.isArray(offersPage.records) ? offersPage.records : []
        for (const offer of records) {
            map.set(String(offer.id), offer as RawOfferRecord)
        }
        return map
    }

    private findNewOffer(
        before: Map<string, RawOfferRecord>,
        after: Map<string, RawOfferRecord>,
        fromAsset: Asset,
        toAsset: Asset
    ): RawOfferRecord | undefined {
        const fromKey = this.assetToKey(fromAsset)
        const toKey = this.assetToKey(toAsset)

        for (const [offerId, offer] of after.entries()) {
            if (before.has(offerId)) continue
            const sellingKey = this.rawOfferAssetToKey(offer.selling)
            const buyingKey = this.rawOfferAssetToKey(offer.buying)
            if (sellingKey === fromKey && buyingKey === toKey) {
                return offer
            }
        }

        return undefined
    }

    private async cancelOffer(
        signer: Keypair,
        offer: RawOfferRecord,
        fromAsset: Asset,
        toAsset: Asset,
        baseFee: number
    ): Promise<void> {
        const parsedPrice = Number.parseFloat(offer.price || '1')
        const cancelPrice = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : 1
        const account = await this.server.loadAccount(signer.publicKey())
        const txBuilder = new TransactionBuilder(account, {
            fee: baseFee.toString(),
            networkPassphrase: this.networkPassphrase
        })

        txBuilder.addOperation(
            Operation.manageSellOffer({
                selling: fromAsset,
                buying: toAsset,
                amount: '0',
                price: cancelPrice.toFixed(7),
                offerId: String(offer.id)
            })
        )
        txBuilder.addMemo(Memo.text('Rebalance cleanup'))
        txBuilder.setTimeout(60)

        const tx = txBuilder.build()
        tx.sign(signer)
        await this.server.submitTransaction(tx)
    }

    private async tryGetAverageTradePrice(txHash: string): Promise<number | undefined> {
        try {
            const tradesBuilder: any = this.server.trades()
            if (typeof tradesBuilder.forTransaction !== 'function') {
                return undefined
            }

            const page = await tradesBuilder.forTransaction(txHash).limit(200).call()
            const records = Array.isArray(page.records) ? page.records as Array<{ base_amount: string, counter_amount: string }> : []
            if (records.length === 0) return undefined

            const totals = records.reduce((acc, trade) => {
                const base = parseFloat(trade.base_amount || '0')
                const counter = parseFloat(trade.counter_amount || '0')
                return {
                    base: acc.base + (Number.isFinite(base) ? base : 0),
                    counter: acc.counter + (Number.isFinite(counter) ? counter : 0)
                }
            }, { base: 0, counter: 0 })

            if (totals.base <= 0 || totals.counter <= 0) return undefined
            return totals.counter / totals.base
        } catch {
            return undefined
        }
    }

    private resolveSigner(userAddress: string, overrideSecret?: string): Keypair {
        const secret = (overrideSecret
            || process.env.STELLAR_REBALANCE_SECRET
            || process.env.STELLAR_SECRET_KEY
            || '').trim()

        if (!secret) {
            throw new Error(
                'Missing signer secret. Set STELLAR_REBALANCE_SECRET or STELLAR_SECRET_KEY, or pass signerSecret in request.'
            )
        }

        const signer = Keypair.fromSecret(secret)
        const allowMismatch = this.readBooleanEnv('REBALANCE_ALLOW_SIGNER_MISMATCH', false)
        if (!allowMismatch && signer.publicKey() !== userAddress) {
            throw new Error(
                `Signer account ${signer.publicKey()} does not match portfolio account ${userAddress}`
            )
        }

        return signer
    }

    private loadAssetIssuers(): Record<string, string> {
        const defaults: Record<string, string> = {
            USDC: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
            BTC: 'GAUTUYY2THLF7SGITDFMXJVYH3LHDSMGEAKSBU267M2K7A3W543CKUEF'
        }

        const raw = process.env.STELLAR_ASSET_ISSUERS
        if (!raw) return defaults

        try {
            const parsed = JSON.parse(raw) as Record<string, string>
            const merged: Record<string, string> = { ...defaults }
            for (const [code, issuer] of Object.entries(parsed)) {
                if (typeof code === 'string' && typeof issuer === 'string' && code && issuer) {
                    merged[code.toUpperCase()] = issuer
                }
            }
            return merged
        } catch {
            return defaults
        }
    }

    private getAssetObject(assetCode: string): Asset {
        const normalized = assetCode.toUpperCase()
        if (normalized === 'XLM') {
            return Asset.native()
        }

        const issuer = this.assetIssuers[normalized]
        if (!issuer) {
            throw new Error(
                `Unsupported asset '${normalized}'. Add its issuer to STELLAR_ASSET_ISSUERS.`
            )
        }

        return new Asset(normalized, issuer)
    }

    private getEffectiveTradeSlippage(config: RebalanceExecutionConfig, tradeOverride?: number): number {
        const fromOverride = tradeOverride && tradeOverride > 0 ? tradeOverride : config.maxSlippageBpsPerTrade
        return Math.min(fromOverride, config.maxSlippageBpsPerRebalance)
    }

    private assetToKey(asset: Asset): string {
        return asset.isNative()
            ? 'XLM'
            : `${asset.getCode()}:${asset.getIssuer()}`
    }

    private rawOfferAssetToKey(asset: RawOfferAsset): string {
        if (asset.asset_type === 'native') return 'XLM'
        return `${asset.asset_code}:${asset.asset_issuer}`
    }

    private amountToString(amount: number): string {
        return this.roundAmount(amount).toFixed(7)
    }

    private roundAmount(amount: number): number {
        return Math.round(amount * 10000000) / 10000000
    }

    private buildTradeMemo(tradeId: string): string {
        const base = `RB ${tradeId}`
        return base.length <= 28 ? base : base.slice(0, 28)
    }

    private readNumberEnv(name: string, fallback: number, min: number, max: number): number {
        const raw = process.env[name]
        if (!raw) return fallback
        const parsed = Number(raw)
        if (!Number.isFinite(parsed)) return fallback
        return Math.min(max, Math.max(min, parsed))
    }

    private readBooleanEnv(name: string, fallback: boolean): boolean {
        const raw = process.env[name]
        if (!raw) return fallback
        return raw.toLowerCase() === 'true'
    }

    private getErrorMessage(error: unknown): string {
        if (error instanceof Error) return error.message
        return String(error)
    }

    private async delay(ms: number): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, ms))
    }
}
