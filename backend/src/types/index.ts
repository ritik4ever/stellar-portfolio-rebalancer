export interface PriceData {
    price: number
    change: number
    timestamp: number
    source?: 'reflector' | 'coingecko_pro' | 'coingecko_free' | 'external' | 'fallback'
    volume?: number
}

export interface PricesMap {
    [asset: string]: PriceData
}

export interface HistoricalPrice {
    timestamp: number
    price: number
}

export interface Portfolio {
    id: string
    userAddress: string
    allocations: Record<string, number>
    threshold: number
    balances: Record<string, number>
    totalValue: number
    createdAt: string
    lastRebalance: string
}