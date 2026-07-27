import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SNAPSHOTS_DIR = join(__dirname, '..', 'src', 'test', 'snapshots', 'fixtures')
const SNAPSHOT_FILE = join(SNAPSHOTS_DIR, 'rebalance-snapshots.json')

interface AllocationInput {
  allocations: Record<string, number>
  balances: Record<string, number>
  prices: Record<string, number>
  threshold: number
}

interface TradeInstruction {
  fromAsset: string
  toAsset: string
  amount: number
  reason: string
}

interface RebalanceSnapshot {
  name: string
  input: AllocationInput
  expectedTrades: TradeInstruction[]
  expectedTotalValue: number
}

function computeRebalanceSnapshot(input: AllocationInput): {
  trades: TradeInstruction[]
  totalValue: number
} {
  const { allocations, balances, prices, threshold } = input

  const totalValue = Object.entries(balances).reduce(
    (sum, [asset, bal]) => sum + bal * (prices[asset] ?? 0),
    0
  )

  if (totalValue === 0) return { trades: [], totalValue: 0 }

  const currentPct: Record<string, number> = {}
  for (const [asset, bal] of Object.entries(balances)) {
    currentPct[asset] = (bal * (prices[asset] ?? 0) / totalValue) * 100
  }

  const trades: TradeInstruction[] = []
  for (const [asset, targetPct] of Object.entries(allocations)) {
    const current = currentPct[asset] ?? 0
    const drift = Math.abs(current - targetPct)
    if (drift > threshold) {
      const diffPct = current - targetPct
      if (diffPct > 0) {
        const excessValue = totalValue * (diffPct / 100)
        const price = prices[asset] ?? 1
        const amount = price > 0 ? excessValue / price : 0
        trades.push({
          fromAsset: asset,
          toAsset: 'USDC',
          amount: Math.round(amount * 10000) / 10000,
          reason: `Drift ${drift.toFixed(1)}% > threshold ${threshold}%`
        })
      } else {
        const deficitValue = totalValue * (Math.abs(diffPct) / 100)
        const price = prices[asset] ?? 1
        const amount = price > 0 ? deficitValue / price : 0
        trades.push({
          fromAsset: 'USDC',
          toAsset: asset,
          amount: Math.round(amount * 10000) / 10000,
          reason: `Drift ${drift.toFixed(1)}% > threshold ${threshold}%`
        })
      }
    }
  }

  return { trades, totalValue: Math.round(totalValue * 100) / 100 }
}

const DEFAULT_PRICES: Record<string, number> = {
  XLM: 0.12,
  BTC: 65000,
  ETH: 3500,
  USDC: 1.0,
  SOL: 140,
}

const SNAPSHOT_FIXTURES: RebalanceSnapshot[] = [
  {
    name: 'successful-rebalance',
    input: {
      allocations: { XLM: 40, BTC: 30, ETH: 20, USDC: 10 },
      balances: { XLM: 50000, BTC: 0.02, ETH: 0.5, USDC: 500 },
      prices: DEFAULT_PRICES,
      threshold: 5,
    },
    expectedTrades: [],
    expectedTotalValue: 0,
  },
  {
    name: 'partial-rebalance-no-trades-needed',
    input: {
      allocations: { XLM: 50, BTC: 50 },
      balances: { XLM: 4166.67, BTC: 0.003846, USDC: 0 },
      prices: { XLM: 0.12, BTC: 65000, USDC: 1 },
      threshold: 10,
    },
    expectedTrades: [],
    expectedTotalValue: 0,
  },
  {
    name: 'failed-rebalance-no-balances',
    input: {
      allocations: { XLM: 40, BTC: 30, ETH: 20, USDC: 10 },
      balances: {},
      prices: DEFAULT_PRICES,
      threshold: 5,
    },
    expectedTrades: [],
    expectedTotalValue: 0,
  },
  {
    name: 'edge-case-zero-prices',
    input: {
      allocations: { XLM: 100 },
      balances: { XLM: 1000 },
      prices: { XLM: 0 },
      threshold: 5,
    },
    expectedTrades: [],
    expectedTotalValue: 0,
  },
  {
    name: 'edge-case-high-drift',
    input: {
      allocations: { XLM: 30, BTC: 30, ETH: 30, USDC: 10 },
      balances: { XLM: 100000, BTC: 0.01, ETH: 0.1, USDC: 100 },
      prices: DEFAULT_PRICES,
      threshold: 2,
    },
    expectedTrades: [],
    expectedTotalValue: 0,
  },
]

function regenerate(): void {
  const snapshots = SNAPSHOT_FIXTURES.map((fixture) => {
    const result = computeRebalanceSnapshot(fixture.input)
    return {
      ...fixture,
      expectedTrades: result.trades,
      expectedTotalValue: result.totalValue,
    }
  })
  mkdirSync(SNAPSHOTS_DIR, { recursive: true })
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshots, null, 2) + '\n')
  console.log(`Regenerated ${snapshots.length} snapshots at ${SNAPSHOT_FILE}`)
}

regenerate()
