interface Trade {
    asset: string
    action: 'buy' | 'sell'
    amount: number
}

export function calculateRelativeMovement(changeA: number, changeB: number): {
  leader: 'a' | 'b' | 'equal'
  relativeChange: number
} {
  if (changeA > changeB) return { leader: 'a', relativeChange: changeA - changeB }
  if (changeB > changeA) return { leader: 'b', relativeChange: changeA - changeB }
  return { leader: 'equal', relativeChange: 0 }
}

export function remainingAllocation(
  allocations: Array<{ percentage: number }>,
): number {
  const total = allocations.reduce((sum, a) => sum + a.percentage, 0)
  return Math.round((100 - total) * 100) / 100
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