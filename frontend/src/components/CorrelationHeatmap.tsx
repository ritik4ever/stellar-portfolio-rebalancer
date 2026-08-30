import React, { useMemo, useState, useCallback } from 'react'
import { Modal } from './ui/Modal'
import { usePriceCandlestick } from '../hooks/queries/usePriceCandlestickQuery'

export type CorrelationTimeRange = '7D' | '30D' | '90D'

export type CorrelationMatrix = number[][]

interface CorrelationHeatmapProps {
  assets: string[]
  correlations: Partial<Record<CorrelationTimeRange, CorrelationMatrix>>
  defaultRange?: CorrelationTimeRange
}

interface HeatmapCell {
  rowAsset: string
  columnAsset: string
  coefficient: number
  rowIndex: number
  columnIndex: number
}

const TIME_RANGES: CorrelationTimeRange[] = ['7D', '30D', '90D']
const MAX_ASSETS = 10

function clampCorrelation(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-1, Math.min(1, value))
}

function formatCoefficient(value: number): string {
  return value === 1 ? '1.0' : value.toFixed(2)
}

export function correlationColor(value: number): string {
  const coefficient = clampCorrelation(value)

  if (coefficient < 0) {
    const channel = Math.round(255 * (1 + coefficient))
    return `rgb(255, ${channel}, ${channel})`
  }

  const redBlue = Math.round(255 * (1 - coefficient))
  return `rgb(${redBlue}, 255, ${redBlue})`
}

function getCoefficient(matrix: CorrelationMatrix | undefined, rowIndex: number, columnIndex: number): number {
  if (rowIndex === columnIndex) return 1
  const value = matrix?.[rowIndex]?.[columnIndex]
  return clampCorrelation(typeof value === 'number' ? value : 0)
}

function computePearsonCorrelation(pricesA: number[], pricesB: number[]): number {
  if (pricesA.length !== pricesB.length || pricesA.length < 3) return 0
  const returnsA: number[] = []
  const returnsB: number[] = []
  for (let i = 1; i < pricesA.length; i++) {
    returnsA.push(pricesA[i] > 0 ? (pricesA[i] - pricesA[i - 1]) / pricesA[i - 1] : 0)
    returnsB.push(pricesB[i] > 0 ? (pricesB[i] - pricesB[i - 1]) / pricesB[i - 1] : 0)
  }
  const n = returnsA.length
  if (n < 3) return 0
  const meanA = returnsA.reduce((s, v) => s + v, 0) / n
  const meanB = returnsB.reduce((s, v) => s + v, 0) / n
  let cov = 0, varA = 0, varB = 0
  for (let i = 0; i < n; i++) {
    const da = returnsA[i] - meanA
    const db = returnsB[i] - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  const denom = Math.sqrt(varA * varB)
  return denom === 0 ? 0 : clampCorrelation(cov / denom)
}

interface SelectedPair {
  rowAsset: string
  columnAsset: string
}

const CorrelationHeatmap: React.FC<CorrelationHeatmapProps> = ({
  assets,
  correlations,
  defaultRange = '30D',
}) => {
  const [selectedRange, setSelectedRange] = useState<CorrelationTimeRange>(defaultRange)
  const [hoveredCell, setHoveredCell] = useState<HeatmapCell | null>(null)
  const [selectedPair, setSelectedPair] = useState<SelectedPair | null>(null)

  const { data: candleDataA } = usePriceCandlestick(
    selectedPair ? selectedPair.rowAsset : null,
    '1D'
  )
  const { data: candleDataB } = usePriceCandlestick(
    selectedPair ? selectedPair.columnAsset : null,
    '1D'
  )

  const trendCorrelations = useMemo(() => {
    if (!candleDataA || !candleDataB) return null
    const pricesA = candleDataA.candles.map((c) => c.close)
    const pricesB = candleDataB.candles.map((c) => c.close)
    if (pricesA.length < 7 || pricesB.length < 7) return null

    const minLen = Math.min(pricesA.length, pricesB.length)
    const alignedA = pricesA.slice(pricesA.length - minLen)
    const alignedB = pricesB.slice(pricesB.length - minLen)

    const fullPeriod = computePearsonCorrelation(alignedA, alignedB)
    const mid = Math.floor(minLen / 2)
    const recent = computePearsonCorrelation(alignedA.slice(mid), alignedB.slice(mid))
    const older = computePearsonCorrelation(alignedA.slice(0, mid), alignedB.slice(0, mid))

    return { fullPeriod, recent, older }
  }, [candleDataA, candleDataB])

  const handleCellClick = useCallback((cell: HeatmapCell) => {
    if (cell.rowAsset !== cell.columnAsset) {
      setSelectedPair({ rowAsset: cell.rowAsset, columnAsset: cell.columnAsset })
    }
  }, [])

  const closeModal = useCallback(() => {
    setSelectedPair(null)
  }, [])

  const visibleAssets = useMemo(() => assets.slice(0, MAX_ASSETS), [assets])
  const selectedMatrix = correlations[selectedRange]

  const cells = useMemo(() => {
    return visibleAssets.flatMap((rowAsset, rowIndex) =>
      visibleAssets.map((columnAsset, columnIndex) => ({
        rowAsset,
        columnAsset,
        rowIndex,
        columnIndex,
        coefficient: getCoefficient(selectedMatrix, rowIndex, columnIndex),
      })),
    )
  }, [selectedMatrix, visibleAssets])

  const gridTemplateColumns = `minmax(3rem, 4rem) repeat(${visibleAssets.length}, minmax(2.75rem, 1fr))`

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm" aria-labelledby="correlation-heatmap-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5">
        <div>
          <h2 id="correlation-heatmap-title" className="text-lg font-semibold text-gray-900 dark:text-white">
            Asset Correlation
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Pairwise correlation coefficients from -1 to +1
          </p>
        </div>

        <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden self-start" role="group" aria-label="Correlation time range">
          {TIME_RANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setSelectedRange(range)}
              aria-pressed={selectedRange === range}
              className={`min-w-12 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                selectedRange === range
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {visibleAssets.length === 0 ? (
        <div className="flex items-center justify-center h-40 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400">
          No assets available
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid gap-1 min-w-[32rem]"
            style={{ gridTemplateColumns }}
            role="grid"
            aria-label={`${selectedRange} asset correlation matrix`}
          >
            <div aria-hidden="true" />
            {visibleAssets.map((asset) => (
              <div
                key={`column-${asset}`}
                className="h-10 flex items-center justify-center text-xs font-semibold text-gray-600 dark:text-gray-300"
                role="columnheader"
              >
                {asset}
              </div>
            ))}

            {visibleAssets.map((rowAsset, rowIndex) => (
              <React.Fragment key={`row-${rowAsset}`}>
                <div
                  className="h-11 flex items-center text-xs font-semibold text-gray-600 dark:text-gray-300"
                  role="rowheader"
                >
                  {rowAsset}
                </div>
                {visibleAssets.map((columnAsset, columnIndex) => {
                  const coefficient = getCoefficient(selectedMatrix, rowIndex, columnIndex)
                  const cell: HeatmapCell = { rowAsset, columnAsset, coefficient, rowIndex, columnIndex }
                  const label = `${rowAsset} to ${columnAsset}: ${coefficient.toFixed(2)}`

                  return (
                    <button
                      key={`${rowAsset}-${columnAsset}`}
                      type="button"
                      role="gridcell"
                      aria-label={label}
                      title={label}
                      onMouseEnter={() => setHoveredCell(cell)}
                      onFocus={() => setHoveredCell(cell)}
                      onMouseLeave={() => setHoveredCell(null)}
                      onBlur={() => setHoveredCell(null)}
                      onClick={() => handleCellClick(cell)}
                      className="h-11 min-w-11 rounded border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer"
                      style={{ backgroundColor: correlationColor(coefficient) }}
                      data-testid={`correlation-cell-${rowIndex}-${columnIndex}`}
                      data-correlation={coefficient.toFixed(2)}
                    >
                      {formatCoefficient(coefficient)}
                    </button>
                  )
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-5 rounded-sm border border-gray-200" style={{ backgroundColor: correlationColor(-1) }} />
          Negative
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-5 rounded-sm border border-gray-200" style={{ backgroundColor: correlationColor(0) }} />
          Zero
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-3 w-5 rounded-sm border border-gray-200" style={{ backgroundColor: correlationColor(1) }} />
          Positive
        </span>
      </div>

      {hoveredCell && (
        <div role="tooltip" className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-800 dark:text-gray-100">
          <span className="font-semibold">{hoveredCell.rowAsset}</span>
          {' / '}
          <span className="font-semibold">{hoveredCell.columnAsset}</span>
          {': '}
          {hoveredCell.coefficient.toFixed(2)}
        </div>
      )}

      <Modal open={!!selectedPair} onClose={closeModal} title="Correlation Detail">
        {selectedPair && (
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Historical correlation trend for <span className="font-semibold text-gray-900 dark:text-white">{selectedPair.rowAsset}</span> / <span className="font-semibold text-gray-900 dark:text-white">{selectedPair.columnAsset}</span>
            </p>

            {trendCorrelations ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Full period</span>
                  <span
                    className="text-sm font-semibold px-2 py-0.5 rounded"
                    style={{
                      color: trendCorrelations.fullPeriod > 0.3 ? '#16a34a' : trendCorrelations.fullPeriod < -0.3 ? '#dc2626' : '#6b7280',
                      backgroundColor: trendCorrelations.fullPeriod > 0.3 ? '#dcfce7' : trendCorrelations.fullPeriod < -0.3 ? '#fee2e2' : '#f3f4f6',
                    }}
                  >
                    {trendCorrelations.fullPeriod.toFixed(3)}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Recent half</span>
                  <span
                    className="text-sm font-semibold px-2 py-0.5 rounded"
                    style={{
                      color: trendCorrelations.recent > 0.3 ? '#16a34a' : trendCorrelations.recent < -0.3 ? '#dc2626' : '#6b7280',
                      backgroundColor: trendCorrelations.recent > 0.3 ? '#dcfce7' : trendCorrelations.recent < -0.3 ? '#fee2e2' : '#f3f4f6',
                    }}
                  >
                    {trendCorrelations.recent.toFixed(3)}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Older half</span>
                  <span
                    className="text-sm font-semibold px-2 py-0.5 rounded"
                    style={{
                      color: trendCorrelations.older > 0.3 ? '#16a34a' : trendCorrelations.older < -0.3 ? '#dc2626' : '#6b7280',
                      backgroundColor: trendCorrelations.older > 0.3 ? '#dcfce7' : trendCorrelations.older < -0.3 ? '#fee2e2' : '#f3f4f6',
                    }}
                  >
                    {trendCorrelations.older.toFixed(3)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading price data for correlation trend...</p>
            )}
          </div>
        )}
      </Modal>
    </section>
  )
}

export default CorrelationHeatmap
