import React, { useCallback, useMemo, useState } from 'react'
import { Modal } from './ui/Modal'

export interface HeatmapAsset {
  name: string
  allocation: number
  change: number
  color?: string
}

interface PortfolioHeatmapProps {
  assets: HeatmapAsset[]
  title?: string
}

const MAX_ASSETS = 10
const CHANGE_SATURATION_CAP = 10

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function heatmapTileColor(change: number): string {
  if (!Number.isFinite(change) || change === 0) {
    return 'rgb(229, 231, 235)'
  }

  const magnitude = Math.min(Math.abs(change), CHANGE_SATURATION_CAP) / CHANGE_SATURATION_CAP

  if (change < 0) {
    const channel = Math.round(255 - 135 * magnitude)
    return `rgb(255, ${channel}, ${channel})`
  }

  const channel = Math.round(255 - 135 * magnitude)
  return `rgb(${channel}, 255, ${channel})`
}

function formatChange(change: number): string {
  if (!Number.isFinite(change)) return 'N/A'
  const sign = change > 0 ? '+' : ''
  return `${sign}${change.toFixed(2)}%`
}

function formatAllocation(allocation: number): string {
  return `${allocation.toFixed(allocation >= 10 ? 0 : 1)}%`
}

const PortfolioHeatmap: React.FC<PortfolioHeatmapProps> = ({ assets, title = 'Portfolio Heatmap' }) => {
  const [selected, setSelected] = useState<HeatmapAsset | null>(null)

  const visibleAssets = useMemo(() => {
    return assets
      .filter((asset) => asset.allocation > 0)
      .slice(0, MAX_ASSETS)
  }, [assets])

  const totalAllocation = useMemo(
    () => visibleAssets.reduce((sum, asset) => sum + asset.allocation, 0),
    [visibleAssets],
  )

  const closeModal = useCallback(() => setSelected(null), [])

  return (
    <section
      className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm"
      aria-labelledby="portfolio-heatmap-title"
    >
      <div className="flex flex-col gap-1 mb-5">
        <h2
          id="portfolio-heatmap-title"
          className="text-lg font-semibold text-gray-900 dark:text-white"
        >
          {title}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Tile size reflects allocation. Color shows 24h price change.
        </p>
      </div>

      {visibleAssets.length === 0 ? (
        <div
          className="flex items-center justify-center h-40 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400"
          data-testid="portfolio-heatmap-empty"
        >
          No assets to display
        </div>
      ) : (
        <div
          className="flex flex-wrap gap-2"
          role="grid"
          aria-label="Portfolio asset heatmap"
          data-testid="portfolio-heatmap-grid"
        >
          {visibleAssets.map((asset) => {
            const share = totalAllocation > 0 ? asset.allocation / totalAllocation : 0
            const flexGrow = clampNumber(asset.allocation, 1, 100)
            const flexBasis = `${Math.max(6, Math.round(share * 100))}rem`
            const label = `${asset.name}: ${formatAllocation(asset.allocation)} allocation, ${formatChange(asset.change)} 24h change`

            return (
              <button
                key={asset.name}
                type="button"
                role="gridcell"
                onClick={() => setSelected(asset)}
                aria-label={label}
                title={label}
                data-testid={`portfolio-heatmap-tile-${asset.name}`}
                data-change={asset.change.toFixed(2)}
                className="relative min-w-[6rem] min-h-[5.5rem] rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-shadow hover:shadow-md"
                style={{
                  flexGrow,
                  flexBasis,
                  backgroundColor: heatmapTileColor(asset.change),
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-sm text-gray-900">{asset.name}</span>
                  <span className="text-xs font-medium text-gray-800">
                    {formatAllocation(asset.allocation)}
                  </span>
                </div>
                <div className="mt-2 text-sm font-semibold text-gray-900">
                  {formatChange(asset.change)}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
        <span className="inline-flex items-center gap-1">
          <span
            className="h-3 w-5 rounded-sm border border-gray-200"
            style={{ backgroundColor: heatmapTileColor(-CHANGE_SATURATION_CAP) }}
          />
          {`Down ${CHANGE_SATURATION_CAP}%+`}
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="h-3 w-5 rounded-sm border border-gray-200"
            style={{ backgroundColor: heatmapTileColor(0) }}
          />
          Flat
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="h-3 w-5 rounded-sm border border-gray-200"
            style={{ backgroundColor: heatmapTileColor(CHANGE_SATURATION_CAP) }}
          />
          {`Up ${CHANGE_SATURATION_CAP}%+`}
        </span>
      </div>

      <Modal open={!!selected} onClose={closeModal} title={selected ? `${selected.name} detail` : undefined}>
        {selected && (
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-gray-500 dark:text-gray-400">Allocation</dt>
              <dd className="font-semibold text-gray-900 dark:text-white">
                {formatAllocation(selected.allocation)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-gray-500 dark:text-gray-400">24h change</dt>
              <dd
                className="font-semibold px-2 py-0.5 rounded"
                style={{
                  color: selected.change > 0 ? '#166534' : selected.change < 0 ? '#991b1b' : '#374151',
                  backgroundColor: heatmapTileColor(selected.change),
                }}
              >
                {formatChange(selected.change)}
              </dd>
            </div>
            {selected.color && (
              <div className="flex items-center justify-between">
                <dt className="text-gray-500 dark:text-gray-400">Asset color</dt>
                <dd className="inline-flex items-center gap-2">
                  <span
                    className="h-4 w-4 rounded-full border border-gray-200"
                    style={{ backgroundColor: selected.color }}
                    aria-hidden
                  />
                  <span className="font-mono text-xs text-gray-700 dark:text-gray-200">
                    {selected.color}
                  </span>
                </dd>
              </div>
            )}
          </dl>
        )}
      </Modal>
    </section>
  )
}

export default PortfolioHeatmap
