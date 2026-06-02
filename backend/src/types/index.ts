export type PriceDataSource =
    | 'reflector'
    | 'coingecko_pro'
    | 'coingecko_free'
    | 'coingecko_browser'
    | 'external'
    | 'fallback'
    | 'fallback_browser'

export type PriceDataTier = 'primary' | 'cached_primary' | 'stale_cached' | 'synthetic_fallback'

export interface PriceFeedMeta {
    provider: 'backend'
    resolvedAtMs: number
    degraded: boolean
    /** True when quotes may be stale or API could not be reached (still not synthetic fallback). */
    staleOrLimited: boolean
    resolutionHint: 'fresh_primary' | 'cached_only' | 'partial_merge' | 'rate_limited_cache' | 'error_recovery_cache' | 'synthetic_fallback'
    assetsCount: number
}

// Core price data interface
export interface PriceData {
    price: number
    change: number
    timestamp: number
    source?: PriceDataSource
    volume?: number
    servedFromCache?: boolean
    serverFetchedAtMs?: number
    cacheAgeMs?: number
    quoteAgeSeconds?: number
    dataTier?: PriceDataTier
}

export interface PricesFeedPayload {
    prices: PricesMap
    feedMeta: PriceFeedMeta
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
    slippageTolerancePercent?: number
    slippageTolerance?: number        // Add this for backward compatibility
    strategy?: RebalanceStrategyType   // Add this
    strategyConfig?: RebalanceStrategyConfig  // Add this
    balances: Record<string, number>
    totalValue: number
    createdAt: string
    lastRebalance: string
    version: number
}

export type RebalanceTrigger = 'auto' | 'manual' | 'system'

export type RebalanceReasonCode =
    | 'THRESHOLD_EXCEEDED'
    | 'SCHEDULED_REBALANCE'
    | 'VOLATILITY_CIRCUIT_BREAKER'
    | 'MANUAL_USER_REQUEST'
    | 'RISK_MITIGATION'
    | 'ON_CHAIN_SYNC'
    | 'SYSTEM_FORCED'
    | 'OTHER'

// Rebalance strategy types
export type RebalanceStrategyType = 'threshold' | 'periodic' | 'volatility' | 'custom'

export interface RebalanceStrategyConfig {
    type?: RebalanceStrategyType
    parameters?: Record<string, unknown>
    enabled?: boolean
    intervalDays?: number
    volatilityThresholdPct?: number
    minDaysBetweenRebalance?: number
}

export interface UIAllocation {
    asset: string
    percentage: number
    value: number
    /** Target allocation % when provided by the UI (alias of percentage in some flows) */
    target?: number
    current?: number
}

// Refresh token session metadata for transparent session management
export interface RefreshTokenMetadata {
    device?: string
    platform?: string
    userAgent?: string
    ipAddress?: string
    lastUsedAt?: string
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

// Thrown when a destructive database operation lacks a recent backup
export class BackupVerificationError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'BackupVerificationError'
    }
}


// Rebalance event interface
export interface RebalanceEvent {
    id: string
    portfolioId: string
    timestamp: string
    trigger: string
    reasonCode?: RebalanceReasonCode
    trades: number
    gasUsed: string
    status: 'completed' | 'failed' | 'pending'
    actor?: 'user' | 'system' | 'admin' | 'scheduler'
    source?: 'dashboard' | 'api' | 'contract' | 'scheduler' | 'auto_rebalance'
    triggerMetadata?: Record<string, unknown>
    eventSource?: 'offchain' | 'simulated' | 'onchain'
    onChainConfirmed?: boolean
    onChainEventType?: string
    onChainTxHash?: string
    onChainLedger?: number
    onChainContractId?: string
    onChainPagingToken?: string
    isSimulated?: boolean
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
        totalSlippageBps?: number
        gasFeeXlm?: number
        gasFeeUsd?: number
        gasPerTradeXlm?: number
        gasWarning?: boolean
        gasBreakdown?: Array<{ tradeId: string, fromAsset?: string, toAsset?: string, feeXlm: number }>
    }
}

// Risk management interfaces
export interface RiskMetrics {
    volatility: number
    concentrationRisk: number
    liquidityRisk: number
    correlationRisk: number
    overallRiskLevel: 'low' | 'medium' | 'high' | 'critical'
    ewmaVolatility: number
    var95: number
    cvar95: number
    maxDrawdown: number
    drawdownBand: 'normal' | 'elevated' | 'critical'
    correlations: Record<string, Record<string, number>>
    sampleSize: number
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
export interface ApiErrorResponseBody {
    code: string
    message: string
    details?: unknown
}

export interface ApiResponse<T = any> {
    success: boolean
    data: T | null
    error: ApiErrorResponseBody | null
    timestamp: string
    meta?: Record<string, unknown>
}

export interface RiskHeatmapDiagnostic {
    score: number
    level: 'low' | 'medium' | 'high'
}

export interface RiskHeatmap {
    concentration: RiskHeatmapDiagnostic
    volatility: RiskHeatmapDiagnostic
    drawdown: RiskHeatmapDiagnostic
}

export interface PortfolioApiResponse extends ApiResponse {
    portfolio?: Portfolio
    prices?: PricesMap
    riskMetrics?: RiskMetrics
    riskHeatmap?: RiskHeatmap
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
    featureFlags?: Record<string, boolean>
}

// Additional utility types
export type AssetCode = 'XLM' | 'BTC' | 'ETH' | 'USDC'

// Metadata about an asset issuer retrieved from stellar.toml
export interface IssuerMetadata {
    org_name?: string
    description?: string
    homepage_url?: string
    cert_url?: string
    org_url?: string
    org_logo?: string
    org_description?: string
    version?: string
}

export interface ParsedAssetCreatePayload {
    symbol: string
    name: string
    contractAddress?: string
    issuerAccount?: string
    coingeckoId?: string
    issuerMetadata?: IssuerMetadata
}

export interface RebalanceRequest {
    portfolioId: string
    userAddress: string
    allocations: Record<string, number>
    threshold: number
}

export interface RebalanceResult {
    trades: number
    plannedTrades?: number
    gasUsed: string
    timestamp: string
    status: 'success' | 'partial' | 'failed'
    newBalances: Record<string, number>
    riskAlerts?: RiskAlert[]
    eventId?: string
    executedTrades?: RebalanceExecutionTrade[]
    partialFills?: RebalanceExecutionTrade[]
    failedTrades?: RebalanceExecutionTrade[]
    failureReasons?: string[]
    rollback?: RebalanceRollback
    totalSlippageBps?: number
    explanation?: ExecutionExplanation
}

export interface RebalanceExecutionTrade {
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

export interface RebalanceRollback {
    attempted: boolean
    success: boolean
    rolledBackTrades: number
    failures: string[]
}

export interface IdempotencyRecord {
    key: string
    requestHash: string
    method: string
    path: string
    statusCode: number
    responseBody: string
    createdAt: string
    expiresAt: string
}

export interface ExecutionExplanation {
    routeLength: number
    estimatedSlippage: number
    skippedAlternatives: string[]
    rationale: string
    failureReason?: string
}
