interface Trade {
    asset: string
    action: 'buy' | 'sell'
    amount: number
}

export interface RelativeMovement {
    /** How much more (positive) or less (negative) asset A moved vs asset B, in percentage points */
    relativeChange: number
    /** Which asset outperformed */
    leader: 'a' | 'b' | 'equal'
}

/**
 * Computes the relative 24h price movement between two assets.
 * @param changeA  24h % change for asset A
 * @param changeB  24h % change for asset B
 */
export function calculateRelativeMovement(changeA: number, changeB: number): RelativeMovement {
    const relativeChange = changeA - changeB
    const leader = relativeChange > 0 ? 'a' : relativeChange < 0 ? 'b' : 'equal'
    return { relativeChange, leader }
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