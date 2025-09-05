export interface PriceData {
    price: number
    change: number
    timestamp: number
}

export interface PricesMap {
    [asset: string]: PriceData
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