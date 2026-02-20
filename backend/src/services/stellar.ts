import { Horizon } from '@stellar/stellar-sdk'
import type { PricesMap } from '../types/index.js'
import { ConflictError } from '../types/index.js'

export class StellarService {
    private server: Horizon.Server
    private contractAddress: string

    constructor() {
        this.server = new Horizon.Server('https://horizon-testnet.stellar.org')
        this.contractAddress = process.env.CONTRACT_ADDRESS || 'CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I'
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
                    balances['XLM'] = parseFloat(balance.balance)
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
                'XLM': 25000,
                'USDC': 10000,
                'BTC': 0.2,
                'ETH': 3.0
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

    async executeRebalance(portfolioId: string) {
        try {
            const { portfolioStorage } = await import('./portfolioStorage.js')
            const { CircuitBreakers } = await import('./circuitBreakers.js')
            const { ReflectorService } = await import('./reflector.js')
            const { RebalanceHistoryService } = await import('./rebalanceHistory.js')
            const { RiskManagementService } = await import('./riskManagements.js')

            const portfolio = await portfolioStorage.getPortfolio(portfolioId)
            if (!portfolio) {
                throw new Error('Portfolio not found')
            }

            // Initialize services
            const reflector = new ReflectorService()
            const rebalanceHistory = new RebalanceHistoryService()
            const riskService = new RiskManagementService()

            // Get current prices
            const prices = await reflector.getCurrentPrices()

            // Enhanced risk checking
            const riskCheck = riskService.shouldAllowRebalance(portfolio, prices)
            if (!riskCheck.allowed) {
                // Record failed attempt
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

            // Check cooldown period
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

            // Legacy market checks
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

            // Check if rebalance is actually needed
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

            // Calculate what assets need rebalancing
            const { trades, trigger } = await this.calculateRebalanceTrades(portfolio, prices)

            // Record rebalance start
            await rebalanceHistory.recordRebalanceEvent({
                portfolioId,
                trigger: 'Rebalance Started',
                trades: 0,
                gasUsed: '0 XLM',
                status: 'pending',
                prices,
                portfolio
            })

            // Simulate rebalance execution
            console.log(`[INFO] Executing rebalance for portfolio ${portfolioId} with ${trades.length} trades`)
            await new Promise(resolve => setTimeout(resolve, 3000))

            // Calculate new balances
            const updatedBalances = await this.calculateRebalancedBalances(portfolio, prices)

            // Compare-and-set: only commit if no concurrent write advanced the version
            portfolioStorage.updatePortfolio(
                portfolioId,
                { lastRebalance: new Date().toISOString(), balances: updatedBalances },
                portfolio.version
            )

            // Record successful rebalance
            const event = await rebalanceHistory.recordRebalanceEvent({
                portfolioId,
                trigger,
                trades: trades.length,
                gasUsed: '0.0234 XLM',
                status: 'completed',
                fromAsset: trades[0]?.fromAsset,
                toAsset: trades[0]?.toAsset,
                amount: trades[0]?.amount,
                prices,
                portfolio
            })

            return {
                trades: trades.length,
                gasUsed: '0.0234 XLM',
                timestamp: new Date().toISOString(),
                status: 'success',
                newBalances: updatedBalances,
                riskAlerts: riskCheck.alerts,
                eventId: event.id
            }
        } catch (error) {
            // Bubble up concurrency conflicts without wrapping so callers can
            // distinguish a 409 Conflict from a generic 500 failure.
            if (error instanceof ConflictError) throw error

            const { RebalanceHistoryService } = await import('./rebalanceHistory.js')
            const rebalanceHistory = new RebalanceHistoryService()

            // Record failed rebalance
            await rebalanceHistory.recordRebalanceEvent({
                portfolioId,
                trigger: 'Execution Failed',
                trades: 0,
                gasUsed: '0 XLM',
                status: 'failed'
            })

            throw new Error(`Rebalance failed: ${error}`)
        }
    }

    // Add this new method to calculate what trades are needed
    private async calculateRebalanceTrades(portfolio: any, prices: PricesMap): Promise<{
        trades: Array<{ fromAsset: string, toAsset: string, amount: number }>,
        trigger: string
    }> {
        let totalValue = 0
        const currentValues: Record<string, number> = {}
        const currentPercentages: Record<string, number> = {}

        // Calculate current portfolio state
        for (const [asset, balance] of Object.entries(portfolio.balances as Record<string, number>)) {
            const price = prices[asset]?.price || 0
            const value = balance * price
            currentValues[asset] = value
            totalValue += value
        }

        // Calculate current percentages and find biggest drift
        let maxDrift = 0
        let driftAsset = ''

        for (const [asset, targetPercentage] of Object.entries(portfolio.allocations)) {
            const currentValue = currentValues[asset] || 0
            const currentPercentage = totalValue > 0 ? (currentValue / totalValue) * 100 : 0
            currentPercentages[asset] = currentPercentage

            const drift = Math.abs(currentPercentage - (targetPercentage as number))
            if (drift > maxDrift) {
                maxDrift = drift
                driftAsset = asset
            }
        }

        // Generate trigger message
        const trigger = `Threshold exceeded (${maxDrift.toFixed(1)}%)`

        // Generate mock trades (in real implementation, calculate actual needed trades)
        const trades = [
            {
                fromAsset: driftAsset,
                toAsset: Object.keys(portfolio.allocations).find(a => a !== driftAsset) || 'USDC',
                amount: Math.floor(totalValue * maxDrift / 100)
            }
        ]

        return { trades, trigger }
    }

    private async calculateRebalancedBalances(portfolio: any, prices: PricesMap): Promise<Record<string, number>> {
        let totalValue = 0
        for (const [asset, balance] of Object.entries(portfolio.balances as Record<string, number>)) {
            const price = prices[asset]?.price || 0
            totalValue += balance * price
        }

        const newBalances: Record<string, number> = {}
        for (const [asset, targetPercentage] of Object.entries(portfolio.allocations)) {
            const targetValue = (totalValue * (targetPercentage as number)) / 100
            const price = prices[asset]?.price || 1
            newBalances[asset] = targetValue / price
        }

        return newBalances
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
                    balance: balance,
                    price: price
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

    private calculateDayChange(allocations: any[]): number {
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
}