import { describe, it, expect } from 'vitest'
import { chartDataState, findAssetsMissingHistory, missingHistoryKey } from './performanceChartState'

describe('chartDataState', () => {
  it('names the empty, single-point and series states', () => {
    expect(chartDataState(0)).toBe('empty')
    expect(chartDataState(1)).toBe('single')
    expect(chartDataState(2)).toBe('series')
  })
})

describe('findAssetsMissingHistory', () => {
  it('finds an asset without a usable value in some snapshots', () => {
    const snapshots = [
      { allocations: { XLM: 50, USDC: 50 } },
      { allocations: { XLM: 50, USDC: null } },
      { allocations: { XLM: 50 } },
      { allocations: { XLM: 50, USDC: 'NaN' } },
    ]
    expect(findAssetsMissingHistory(snapshots)).toEqual([{ asset: 'USDC', missingPoints: 3, totalPoints: 4 }])
  })

  it('orders by most missing points, then by name', () => {
    const snapshots = [
      { allocations: { A: 1, B: null, C: null } },
      { allocations: { A: null, B: 1, C: null } },
    ]
    expect(findAssetsMissingHistory(snapshots).map((m) => m.asset)).toEqual(['C', 'A', 'B'])
  })

  it('ignores snapshots without per-asset data and returns nothing when none have it', () => {
    expect(findAssetsMissingHistory([{ totalValue: 1 }, { totalValue: 2 }])).toEqual([])
    expect(findAssetsMissingHistory(undefined)).toEqual([])
    expect(findAssetsMissingHistory([{ totalValue: 1 }, { allocations: { XLM: 1 } }])).toEqual([])
  })

  it('accepts numeric strings and zero as usable values', () => {
    expect(findAssetsMissingHistory([{ allocations: { XLM: '10.5' } }, { allocations: { XLM: 0 } }])).toEqual([])
  })
})

describe('missingHistoryKey', () => {
  it('changes when the range or the missing set changes', () => {
    const one = [{ asset: 'USDC', missingPoints: 1, totalPoints: 3 }]
    expect(missingHistoryKey('1d', one)).toBe(missingHistoryKey('1d', [...one]))
    expect(missingHistoryKey('1d', one)).not.toBe(missingHistoryKey('1w', one))
    expect(missingHistoryKey('1d', one)).not.toBe(missingHistoryKey('1d', [{ ...one[0], missingPoints: 2 }]))
  })
})
