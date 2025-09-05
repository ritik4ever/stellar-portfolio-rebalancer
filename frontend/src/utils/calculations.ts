interface Trade {
    asset: string
    action: 'buy' | 'sell'
    amount: number
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