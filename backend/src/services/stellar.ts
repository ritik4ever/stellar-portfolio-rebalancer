import { Horizon } from '@stellar/stellar-sdk'

import { ConflictError } from '../types/index.js'
import type { PricesMap, RebalanceResult } from '../types/index.js'
import {
    StellarDEXService,
    type DEXTradeRequest,
    type DEXTradeExecutionResult,
    type RebalanceExecutionConfig
} from './dex.js'

interface StoredPortfolio {
    id: string
    userAddress: string
    allocations: Record<string, number>
    threshold: number
    balances: Record<string, number>
    totalValue: number
    // Optional version field used for compare-and-set updates
    version?: number
    createdAt: string
    lastRebalance: string
}

export interface ExecuteRebalanceOptions extends Partial<RebalanceExecutionConfig> {
    tradeSlippageBps?: number
    tradeSlippageOverrides?: Record<string, number>
}

export class StellarService {
    private server: Horizon.Server
    private contractAddress: string
    private dexService: StellarDEXService

    constructor() {
        const network = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase()
        const horizonUrl = process.env.STELLAR_HORIZON_URL
            || (network === 'mainnet'
                ? 'https://horizon.stellar.org'
                : 'https://horizon-testnet.stellar.org')

        this.server = new Horizon.Server(horizonUrl)
        this.contractAddress = process.env.CONTRACT_ADDRESS || process.env.STELLAR_CONTRACT_ADDRESS
            || 'CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I'
        this.dexService = new StellarDEXService()
    }

    async createPortfolio(userAddress: string, allocations: Record<string, number>, threshold: number) {
        try {
            const total = Object.values(allocations).reduce((sum, val) => sum + val, 0)
            if (Math.abs(total - 100) > 0.01) {
                throw new Error('Allocations must sum to 100%')
            }

            await this.checkConcentrationRisk(allocations)

            const mockBalances: Record<string, number> = {}
            const { ReflectorService } = await import('./reflector.js')
            const reflector = new ReflectorService()
            const prices = await reflector.getCurrentPrices()

            const totalValue = 10000

            for (const [asset, percentage] of Object.entries(allocations)) {
                const assetValue = (totalValue * percentage) / 100
                const price = prices[asset]?.price || 1
                mockBalances[asset] = assetValue / price
            }

            const { portfolioStorage } = await import('./portfolioStorage.js')
            const portfolioId = await portfolioStorage.createPortfolioWithBalances(userAddress, allocations, threshold, mockBalances)

            console.log(`Demo portfolio ${portfolioId} created with $${totalValue} simulated value`)
            return portfolioId
        } catch (error) {
            throw new Error(`Failed to create portfolio: ${error}`)
        }
    }

    async checkConcentrationRisk(allocations: Record<string, number>, maxSingleAsset: number = 70): Promise<boolean> {
        for (const [asset, percentage] of Object.entries(allocations)) {
            if (percentage > maxSingleAsset) {
                throw new Error(`Asset ${asset} exceeds maximum concentration limit of ${maxSingleAsset}%`)
            }
        }

        const assetCount = Object.keys(allocations).length
        if (assetCount < 1) {
            throw new Error('Portfolio must contain at least 1 asset')
        }

        return true
    }

    async getRealAssetBalances(userAddress: string): Promise<Record<string, number>> {
        try {
            const account = await this.server.loadAccount(userAddress)
            const balances: Record<string, number> = {}

            for (const balance of account.balances) {
                if (balance.asset_type === 'native') {
                    balances.XLM = parseFloat(balance.balance)
                } else if (balance.asset_type === 'credit_alphanum4' || balance.asset_type === 'credit_alphanum12') {
                    const assetCode = balance.asset_code
                    balances[assetCode] = parseFloat(balance.balance)
                }
            }

            return balances
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            console.warn('Could not fetch real balances, using demo mode:', errorMessage)
            return {
                XLM: 25000,
                USDC: 10000,
                BTC: 0.2,
                ETH: 3.0
            }
        }
    }

    async checkRebalanceNeeded(portfolioId: string): Promise<boolean> {
        try {
            const { portfolioStorage } = await import('./portfolioStorage.js')
            const { ReflectorService } = await import('./reflector.js')

            const portfolio = await portfolioStorage.getPortfolio(portfolioId)
            if (!portfolio) return false

            const reflector = new ReflectorService()
            const prices = await reflector.getCurrentPrices()

            let totalValue = 0
            const currentValues: Record<string, number> = {}

            for (const [asset, balance] of Object.entries(portfolio.balances)) {
                const price = prices[asset]?.price || 0
                const value = balance * price
                currentValues[asset] = value
                totalValue += value
            }

            if (totalValue === 0) return false

            for (const [asset, targetPercentage] of Object.entries(portfolio.allocations)) {
                const currentValue = currentValues[asset] || 0
                const currentPercentage = (currentValue / totalValue) * 100
                const drift = Math.abs(currentPercentage - targetPercentage)

                if (drift > 50) {
                    console.warn(`Excessive drift detected for ${asset}: ${drift}%`)
                    return false
                }

                if (drift > portfolio.threshold) {
                    return true
                }
            }

            return false
        } catch (error) {
            console.error('Error checking rebalance need:', error)
            return false
        }
    }

    async executeRebalance(portfolioId: string, options: ExecuteRebalanceOptions = {}): Promise<RebalanceResult> {
        try {
            const { portfolioStorage } = await import('./portfolioStorage.js')
            const { CircuitBreakers } = await import('./circuitBreakers.js')
            const { ReflectorService } = await import('./reflector.js')
            const { RebalanceHistoryService } = await import('./rebalanceHistory.js')
            const { RiskManagementService } = await import('./riskManagements.js')

            const portfolio = await portfolioStorage.getPortfolio(portfolioId) as StoredPortfolio | undefined
            if (!portfolio) {
                throw new Error('Portfolio not found')
            }

            const reflector = new ReflectorService()
            const rebalanceHistory = new RebalanceHistoryService()
            const riskService = new RiskManagementService()
            const prices = await reflector.getCurrentPrices()

            const riskCheck = riskService.shouldAllowRebalance(portfolio, prices)
            if (!riskCheck.allowed) {
                await rebalanceHistory.recordRebalanceEvent({
                    portfolioId,
                    trigger: 'Risk Management Block',
                    trades: 0,
                    gasUsed: '0 XLM',
                    status: 'failed',
                    prices,
                    portfolio
                })

                throw new Error(`Rebalance blocked: ${riskCheck.reason}`)
            }

            const lastRebalance = new Date(portfolio.lastRebalance).getTime()
            const now = Date.now()
            const hourInMs = 60 * 60 * 1000

            if (now - lastRebalance < hourInMs) {
                await rebalanceHistory.recordRebalanceEvent({
                    portfolioId,
                    trigger: 'Cooldown Period Active',
                    trades: 0,
                    gasUsed: '0 XLM',
                    status: 'failed',
                    prices,
                    portfolio
                })

                throw new Error('Cooldown period active. Please wait before rebalancing again.')
            }

            const marketCheck = await CircuitBreakers.checkMarketConditions(prices)
            if (!marketCheck.safe) {
                await rebalanceHistory.recordRebalanceEvent({
                    portfolioId,
                    trigger: 'Circuit Breaker Triggered',
                    trades: 0,
                    gasUsed: '0 XLM',
                    status: 'failed',
                    prices,
                    portfolio
                })

                throw new Error(`Rebalance blocked: ${marketCheck.reason}`)
            }

            const needed = await this.checkRebalanceNeeded(portfolioId)
            if (!needed) {
                await rebalanceHistory.recordRebalanceEvent({
                    portfolioId,
                    trigger: 'No Rebalance Needed',
                    trades: 0,
                    gasUsed: '0 XLM',
                    status: 'completed',
                    prices,
                    portfolio
                })

                throw new Error('Rebalance not needed at this time')
            }

            const { trades, trigger } = this.calculateRebalanceTrades(portfolio, prices, options.tradeSlippageOverrides, options.tradeSlippageBps)
            if (trades.length === 0) {
                throw new Error('No executable trades generated from current drift')
            }

            await rebalanceHistory.recordRebalanceEvent({
                portfolioId,
                trigger: 'Rebalance Started',
                trades: 0,
                gasUsed: '0 XLM',
                status: 'pending',
                prices,
                portfolio
            })

            const dexConfig = this.buildDexConfig(options)
            const dexResult = await this.dexService.executeRebalanceTrades(
                portfolio.userAddress,
                trades,
                dexConfig
            )

            const shouldApplyExecutions = !(dexResult.status === 'failed' && dexResult.rollback.success)
            const updatedBalances = shouldApplyExecutions
                ? this.applyExecutionToBalances(portfolio.balances, dexResult.executedTrades)
                : { ...portfolio.balances }

            // Compare-and-set: only commit if no concurrent write advanced the version
            portfolioStorage.updatePortfolio(
                portfolioId,
                { lastRebalance: new Date().toISOString(), balances: updatedBalances },
                portfolio.version
            )
            const updatedTotalValue = this.calculateTotalValue(updatedBalances, prices)

            if (dexResult.status !== 'failed') {
                await portfolioStorage.updatePortfolio(portfolioId, {
                    lastRebalance: new Date().toISOString(),
                    balances: updatedBalances,
                    totalValue: updatedTotalValue
                })
            } else if (shouldApplyExecutions) {
                await portfolioStorage.updatePortfolio(portfolioId, {
                    balances: updatedBalances,
                    totalValue: updatedTotalValue
                })
            }

            const firstExecuted = dexResult.executedTrades.find(t => t.executedAmount > 0)
            const failureReasons = dexResult.failedTrades.map(t => t.failureReason).filter(Boolean) as string[]
            const historyStatus = dexResult.status === 'failed' ? 'failed' : 'completed'

            const event = await rebalanceHistory.recordRebalanceEvent({
                portfolioId,
                trigger: dexResult.status === 'failed'
                    ? `Execution Failed: ${dexResult.failureReason || 'unknown reason'}`
                    : trigger,
                trades: dexResult.executedTrades.filter(t => t.executedAmount > 0 && !t.rolledBack).length,
                gasUsed: `${dexResult.totalEstimatedFeeXLM.toFixed(7)} XLM`,
                status: historyStatus,
                fromAsset: firstExecuted?.fromAsset,
                toAsset: firstExecuted?.toAsset,
                amount: firstExecuted?.executedAmount,
                prices,
                portfolio,
                error: failureReasons.join('; ') || undefined
            })

            const overallStatus = dexResult.status === 'success'
                ? 'success'
                : dexResult.status === 'partial'
                    ? 'partial'
                    : 'failed'

            return {
                trades: dexResult.executedTrades.filter(t => t.executedAmount > 0 && !t.rolledBack).length,
                plannedTrades: trades.length,
                gasUsed: `${dexResult.totalEstimatedFeeXLM.toFixed(7)} XLM`,
                timestamp: new Date().toISOString(),
                status: overallStatus,
                newBalances: updatedBalances,
                riskAlerts: riskCheck.alerts,
                eventId: event.id,
                executedTrades: dexResult.executedTrades,
                partialFills: dexResult.partialFills,
                failedTrades: dexResult.failedTrades,
                failureReasons,
                rollback: dexResult.rollback,
                totalSlippageBps: dexResult.totalSlippageBps
            }
        } catch (error) {
            // Bubble up concurrency conflicts without wrapping so callers can
            // distinguish a 409 Conflict from a generic 500 failure.
            if (error instanceof ConflictError) throw error

            const { RebalanceHistoryService } = await import('./rebalanceHistory.js')
            const rebalanceHistory = new RebalanceHistoryService()
            const message = error instanceof Error ? error.message : String(error)

            await rebalanceHistory.recordRebalanceEvent({
                portfolioId,
                trigger: 'Execution Failed',
                trades: 0,
                gasUsed: '0 XLM',
                status: 'failed',
                error: message
            })

            throw new Error(`Rebalance failed: ${message}`)
        }
    }

    private calculateRebalanceTrades(
        portfolio: StoredPortfolio,
        prices: PricesMap,
        slippageOverrides?: Record<string, number>,
        defaultTradeSlippageBps?: number
    ): { trades: DEXTradeRequest[], trigger: string } {
        const currentValues: Record<string, number> = {}
        const currentPercents: Record<string, number> = {}
        let totalValue = 0

        for (const [asset, balance] of Object.entries(portfolio.balances)) {
            const price = prices[asset]?.price || 0
            const value = balance * price
            currentValues[asset] = value
            totalValue += value
        }

        if (totalValue <= 0) {
            return { trades: [], trigger: 'No Portfolio Value' }
        }

        const diffs: Array<{ asset: string, diffValue: number }> = []
        let maxDrift = 0

        for (const [asset, targetPct] of Object.entries(portfolio.allocations)) {
            const currentValue = currentValues[asset] || 0
            const currentPct = (currentValue / totalValue) * 100
            currentPercents[asset] = currentPct
            maxDrift = Math.max(maxDrift, Math.abs(currentPct - targetPct))

            const targetValue = (totalValue * targetPct) / 100
            diffs.push({ asset, diffValue: currentValue - targetValue })
        }

        const minTradeUsd = this.readNumberEnv('MIN_TRADE_SIZE_USD', 10, 0.01, Number.MAX_SAFE_INTEGER)
        const overs = diffs
            .filter(item => item.diffValue > minTradeUsd)
            .sort((a, b) => b.diffValue - a.diffValue)
        const unders = diffs
            .filter(item => item.diffValue < -minTradeUsd)
            .map(item => ({ asset: item.asset, needed: Math.abs(item.diffValue) }))
            .sort((a, b) => b.needed - a.needed)

        const trades: DEXTradeRequest[] = []
        let tradeCounter = 0

        for (const over of overs) {
            const fromPrice = prices[over.asset]?.price || 0
            if (fromPrice <= 0) continue

            let remainingOverValue = over.diffValue
            for (const under of unders) {
                if (remainingOverValue <= minTradeUsd) break
                if (under.needed <= minTradeUsd) continue

                const transferValue = Math.min(remainingOverValue, under.needed)
                if (transferValue <= minTradeUsd) continue

                const amountToSell = transferValue / fromPrice
                if (amountToSell <= 0) continue

                const overrideKey = `${over.asset}->${under.asset}`
                const maxSlippageBps = slippageOverrides?.[overrideKey] ?? defaultTradeSlippageBps

                trades.push({
                    tradeId: `trade-${++tradeCounter}`,
                    fromAsset: over.asset,
                    toAsset: under.asset,
                    amount: this.roundAmount(amountToSell),
                    maxSlippageBps
                })

                remainingOverValue -= transferValue
                under.needed -= transferValue
            }
        }

        const trigger = `Threshold exceeded (${maxDrift.toFixed(1)}%)`
        return { trades, trigger }
    }

    private buildDexConfig(options: ExecuteRebalanceOptions): Partial<RebalanceExecutionConfig> {
        const config: Partial<RebalanceExecutionConfig> = {}

        if (options.tradeSlippageBps !== undefined) {
            config.maxSlippageBpsPerTrade = options.tradeSlippageBps
        } else if (options.maxSlippageBpsPerTrade !== undefined) {
            config.maxSlippageBpsPerTrade = options.maxSlippageBpsPerTrade
        }

        if (options.maxSlippageBpsPerRebalance !== undefined) {
            config.maxSlippageBpsPerRebalance = options.maxSlippageBpsPerRebalance
        }
        if (options.maxSpreadBps !== undefined) {
            config.maxSpreadBps = options.maxSpreadBps
        }
        if (options.minLiquidityCoverage !== undefined) {
            config.minLiquidityCoverage = options.minLiquidityCoverage
        }
        if (options.allowPartialFill !== undefined) {
            config.allowPartialFill = options.allowPartialFill
        }
        if (options.rollbackOnFailure !== undefined) {
            config.rollbackOnFailure = options.rollbackOnFailure
        }
        if (options.signerSecret !== undefined) {
            config.signerSecret = options.signerSecret
        }

        return config
    }

    private applyExecutionToBalances(
        initialBalances: Record<string, number>,
        executedTrades: DEXTradeExecutionResult[]
    ): Record<string, number> {
        const balances: Record<string, number> = { ...initialBalances }

        for (const trade of executedTrades) {
            if (trade.executedAmount <= 0) continue
            if (trade.rolledBack) continue

            const fromBefore = balances[trade.fromAsset] || 0
            const toBefore = balances[trade.toAsset] || 0

            balances[trade.fromAsset] = Math.max(0, this.roundAmount(fromBefore - trade.executedAmount))
            balances[trade.toAsset] = this.roundAmount(toBefore + trade.estimatedReceivedAmount)
        }

        return balances
    }

    private calculateTotalValue(balances: Record<string, number>, prices: PricesMap): number {
        return Object.entries(balances).reduce((sum, [asset, balance]) => {
            const price = prices[asset]?.price || 0
            return sum + (balance * price)
        }, 0)
    }

    async getPortfolio(portfolioId: string) {
        try {
            const { portfolioStorage } = await import('./portfolioStorage.js')
            const { ReflectorService } = await import('./reflector.js')

            const portfolio = await portfolioStorage.getPortfolio(portfolioId)
            if (!portfolio) {
                throw new Error('Portfolio not found')
            }

            const reflector = new ReflectorService()
            const prices = await reflector.getCurrentPrices()

            let totalValue = 0
            const allocations = []

            for (const [asset, targetPercentage] of Object.entries(portfolio.allocations)) {
                const balance = portfolio.balances[asset] || 0
                const price = prices[asset]?.price || 0
                const value = balance * price
                totalValue += value

                allocations.push({
                    asset,
                    target: targetPercentage,
                    current: 0,
                    amount: value,
                    balance,
                    price
                })
            }

            allocations.forEach(alloc => {
                alloc.current = totalValue > 0 ? (alloc.amount / totalValue) * 100 : 0
            })

            const needsRebalance = await this.checkRebalanceNeeded(portfolioId)

            return {
                id: portfolioId,
                userAddress: portfolio.userAddress,
                totalValue,
                allocations,
                needsRebalance,
                lastRebalance: portfolio.lastRebalance,
                threshold: portfolio.threshold,
                dayChange: this.calculateDayChange(allocations)
            }
        } catch (error) {
            throw new Error(`Failed to fetch portfolio: ${error}`)
        }
    }

    private calculateDayChange(allocations: Array<{ current: number }>): number {
        let weightedChange = 0
        let totalWeight = 0

        for (const allocation of allocations) {
            const priceChange = Math.random() * 4 - 2
            const weight = allocation.current / 100
            weightedChange += priceChange * weight
            totalWeight += weight
        }

        return totalWeight > 0 ? weightedChange / totalWeight : 0
    }

    private roundAmount(amount: number): number {
        return Math.round(amount * 10000000) / 10000000
    }

    private readNumberEnv(name: string, fallback: number, min: number, max: number): number {
        const raw = process.env[name]
        if (!raw) return fallback
        const parsed = Number(raw)
        if (!Number.isFinite(parsed)) return fallback
        return Math.max(min, Math.min(max, parsed))
    }
}
