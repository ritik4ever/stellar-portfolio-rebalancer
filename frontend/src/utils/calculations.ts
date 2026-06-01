interface Trade {
    asset: string
    action: 'buy' | 'sell'
    amount: number
}

/**
 * Returns how many percentage points remain to reach 100%.
 * Positive  → under-allocated (e.g. 30 means 30% still to assign)
 * Negative  → over-allocated  (e.g. -5 means 5% too many)
 * Zero      → exactly 100%
 */
export const remainingAllocation = (allocations: { percentage: number }[]): number => {
    const total = allocations.reduce((sum, a) => sum + a.percentage, 0)
    return parseFloat((100 - total).toFixed(10))
}

export const calculateRebalanceTrades = (portfolio: any): Trade[] => {
    const trades: Trade[] = []

    for (const asset of portfolio.allocations) {
        const drift = asset.current - asset.target

        if (Math.abs(drift) > portfolio.threshold) {
            const targetValue = (portfolio.totalValue * asset.target) / 100
            const difference = targetValue - asset.amount

            if (Math.abs(difference) > 10) {
                trades.push({
                    asset: asset.asset,
                    action: difference > 0 ? 'buy' : 'sell',
                    amount: Math.abs(difference)
                })
            }
        }
    }

    return trades
}