import { describe, expect, it } from 'vitest'
import { aggregateCandles, type OHLCVCandle } from './usePriceCandlestickQuery'

const candles: OHLCVCandle[] = [
  { time: Date.UTC(2026, 0, 5, 0, 15), open: 1, high: 3, low: 0.8, close: 2, volume: 10 },
  { time: Date.UTC(2026, 0, 5, 0, 45), open: 2, high: 4, low: 1.5, close: 3, volume: 20 },
  { time: Date.UTC(2026, 0, 5, 1, 15), open: 3, high: 5, low: 2.5, close: 4, volume: 30 },
  { time: Date.UTC(2026, 0, 6, 1, 15), open: 4, high: 6, low: 3.5, close: 5, volume: 40 },
]

describe('aggregateCandles', () => {
  it('aggregates candles into hourly OHLCV buckets', () => {
    const result = aggregateCandles(candles, '1H')

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({
      time: Date.UTC(2026, 0, 5, 0, 0),
      open: 1,
      high: 4,
      low: 0.8,
      close: 3,
      volume: 30,
    })
  })

  it('aggregates candles into daily and weekly OHLCV buckets', () => {
    expect(aggregateCandles(candles, '1D')).toEqual([
      { time: Date.UTC(2026, 0, 5, 0, 0), open: 1, high: 5, low: 0.8, close: 4, volume: 60 },
      { time: Date.UTC(2026, 0, 6, 0, 0), open: 4, high: 6, low: 3.5, close: 5, volume: 40 },
    ])

    expect(aggregateCandles(candles, '1W')).toEqual([
      { time: Date.UTC(2026, 0, 5, 0, 0), open: 1, high: 6, low: 0.8, close: 5, volume: 100 },
    ])
  })
})
