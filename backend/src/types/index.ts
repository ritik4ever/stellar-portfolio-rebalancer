// Core price data interface
export interface PriceData {
    price: number
    change: number
    timestamp: number
    source?: 'reflector' | 'coingecko_pro' | 'coingecko_free' | 'external' | 'fallback'
    volume?: number
}

// Price map type - using type alias as expected by risk management service
export type PricesMap = Record<string, PriceData>

// Historical price data
export interface HistoricalPrice {
    timestamp: number
    price: number
}

// Portfolio interface
export interface Portfolio {
    id: string
    userAddress: string
    allocations: Record<string, number>
    threshold: number
    balances: Record<string, number>
    totalValue: number
    createdAt: string
    lastRebalance: string
    version: number
}

// Thrown when an update targets a stale portfolio version
export class ConflictError extends Error {
    readonly currentVersion: number
    constructor(currentVersion: number) {
        super(`Portfolio was modified concurrently (current version: ${currentVersion})`)
        this.name = 'ConflictError'
        this.currentVersion = currentVersion
    }
}

// Rebalance event interface
export interface RebalanceEvent {
    id: string
    portfolioId: string
    timestamp: string
    trigger: string
    trades: number
    gasUsed: string
    status: 'completed' | 'failed' | 'pending'
    details?: {
        fromAsset?: string
        toAsset?: string
        amount?: number
        reason?: string
        volatilityDetected?: boolean
        riskLevel?: 'low' | 'medium' | 'high'
        priceDirection?: 'up' | 'down'
        performanceImpact?: 'positive' | 'negative' | 'neutral'
        riskMetrics?: any
        marketConditions?: any
    }
}

// Risk management interfaces
export interface RiskMetrics {
    volatility: number
    concentrationRisk: number
    liquidityRisk: number
    correlationRisk: number
    overallRiskLevel: 'low' | 'medium' | 'high' | 'critical'
}

export interface RiskAlert {
    type: 'volatility' | 'concentration' | 'liquidity' | 'correlation' | 'circuit_breaker'
    severity: 'warning' | 'critical'
    message: string
    asset?: string
    recommendedAction: string
    timestamp: number
}

export interface CircuitBreakerStatus {
    isTriggered: boolean
    triggerReason?: string
    cooldownUntil?: number
    triggeredAssets: string[]
}

// API response interfaces
export interface ApiResponse<T = any> {
    success: boolean
    data?: T
    error?: string
    timestamp: string
}

export interface PortfolioApiResponse extends ApiResponse {
    portfolio?: Portfolio
    prices?: PricesMap
    riskMetrics?: RiskMetrics
}

export interface RebalanceHistoryResponse extends ApiResponse {
    history: RebalanceEvent[]
    count: number
}

// Trade interface
export interface Trade {
    fromAsset: string
    toAsset: string
    amount: number
    price?: number
    timestamp?: string
}

// Market data interface
export interface MarketData {
    asset: string
    price: number
    change24h: number
    volume24h: number
    marketCap?: number
    high24h?: number
    low24h?: number
    source: string
    lastUpdated: string
}

// WebSocket message types
export interface WebSocketMessage {
    type: 'portfolio_update' | 'market_update' | 'risk_alert' | 'rebalance_complete' | 'connection' | 'heartbeat'
    portfolioId?: string
    event?: string
    data?: any
    timestamp: string
}

// System status interface
export interface SystemStatus {
    system: {
        status: 'operational' | 'degraded' | 'error'
        uptime: number
        timestamp: string
        version: string
    }
    portfolios: {
        total: number
        active: number
    }
    rebalanceHistory: {
        totalEvents: number
        portfolios: number
        recentActivity: number
    }
    riskManagement: {
        circuitBreakers: Record<string, CircuitBreakerStatus>
        enabled: boolean
        alertsActive: boolean
    }
    services: {
        priceFeeds: boolean
        riskManagement: boolean
        webSockets: boolean
        autoRebalancing: boolean
        stellarNetwork: boolean
    }
}

// Additional utility types
export type AssetCode = 'XLM' | 'BTC' | 'ETH' | 'USDC'

export interface RebalanceRequest {
    portfolioId: string
    userAddress: string
    allocations: Record<string, number>
    threshold: number
}

export interface RebalanceResult {
    trades: number
    gasUsed: string
    timestamp: string
    status: 'success' | 'failed'
    newBalances: Record<string, number>
    riskAlerts?: RiskAlert[]
    eventId?: string
}