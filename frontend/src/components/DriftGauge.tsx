import React, { useMemo, useState } from 'react'

export interface DriftGaugeAsset {
  name: string
  target: number
  current: number
  threshold: number
}

interface DriftGaugeProps {
  asset: DriftGaugeAsset
  size?: number
}

interface DriftGaugeGridProps {
  assets: DriftGaugeAsset[]
  title?: string
}

type DriftStatus = 'ok' | 'warning' | 'critical'

function getDriftStatus(drift: number, threshold: number): DriftStatus {
  const abs = Math.abs(drift)
  if (abs >= threshold) return 'critical'
  if (abs >= threshold * 0.5) return 'warning'
  return 'ok'
}

const STATUS_COLORS: Record<DriftStatus, { stroke: string; text: string; bg: string; label: string }> = {
  ok: {
    stroke: '#22c55e',
    text: 'text-green-600 dark:text-green-400',
    bg: '#dcfce7',
    label: 'Within target',
  },
  warning: {
    stroke: '#f59e0b',
    text: 'text-amber-600 dark:text-amber-400',
    bg: '#fef9c3',
    label: 'Approaching threshold',
  },
  critical: {
    stroke: '#ef4444',
    text: 'text-red-600 dark:text-red-400',
    bg: '#fee2e2',
    label: 'Exceeds threshold',
  },
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngleDeg: number,
  endAngleDeg: number
): string {
  const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180
  const start = {
    x: cx + r * Math.cos(toRad(startAngleDeg)),
    y: cy + r * Math.sin(toRad(startAngleDeg)),
  }
  const end = {
    x: cx + r * Math.cos(toRad(endAngleDeg)),
    y: cy + r * Math.sin(toRad(endAngleDeg)),
  }
  const largeArc = endAngleDeg - startAngleDeg > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

const ARC_START = -135
const ARC_END = 135
const ARC_SPAN = ARC_END - ARC_START

export const DriftGauge: React.FC<DriftGaugeProps> = ({ asset, size = 96 }) => {
  const { name, target, current, threshold } = asset

  const drift = useMemo(() => current - target, [current, target])
  const status = useMemo(() => getDriftStatus(drift, threshold), [drift, threshold])
  const colors = STATUS_COLORS[status]

  const cx = size / 2
  const cy = size / 2
  const strokeWidth = Math.max(4, size * 0.08)
  const r = (size - strokeWidth * 2) / 2

  const trackPath = describeArc(cx, cy, r, ARC_START, ARC_END)

  const clampedCurrent = Math.min(100, Math.max(0, current))
  const fillEndAngle = ARC_START + (clampedCurrent / 100) * ARC_SPAN
  const fillPath = describeArc(cx, cy, r, ARC_START, fillEndAngle)

  const targetAngle = ARC_START + (Math.min(100, Math.max(0, target)) / 100) * ARC_SPAN
  const tickInner = r - strokeWidth * 0.6
  const tickOuter = r + strokeWidth * 0.6
  const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180
  const tickStart = {
    x: cx + tickInner * Math.cos(toRad(targetAngle)),
    y: cy + tickInner * Math.sin(toRad(targetAngle)),
  }
  const tickEnd = {
    x: cx + tickOuter * Math.cos(toRad(targetAngle)),
    y: cy + tickOuter * Math.sin(toRad(targetAngle)),
  }

  const driftLabel = `${drift >= 0 ? '+' : ''}${drift.toFixed(1)}%`
  const ariaLabel = `${name}: current ${current.toFixed(1)}%, target ${target.toFixed(1)}%, drift ${driftLabel}. Status: ${colors.label}.`

  const [showTooltip, setShowTooltip] = React.useState(false)

  const fontSize = Math.max(8, size * 0.13)
  const assetFontSize = Math.max(9, size * 0.15)

  return (
    <div
      className="relative inline-flex flex-col items-center"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onFocus={() => setShowTooltip(true)}
      onBlur={() => setShowTooltip(false)}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel}
        focusable="true"
        tabIndex={0}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-full"
      >
        <path
          d={trackPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="text-gray-200 dark:text-gray-700"
        />

        {clampedCurrent > 0 && (
          <path
            d={fillPath}
            fill="none"
            stroke={colors.stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            style={{ transition: 'stroke 0.3s ease, stroke-dashoffset 0.4s ease' }}
          />
        )}

        <line
          x1={tickStart.x}
          y1={tickStart.y}
          x2={tickEnd.x}
          y2={tickEnd.y}
          stroke="#6b7280"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden="true"
        />

        <text
          x={cx}
          y={cy - fontSize * 0.4}
          textAnchor="middle"
          fontSize={assetFontSize}
          fontWeight="600"
          fill="currentColor"
          className="fill-gray-900 dark:fill-white"
          aria-hidden="true"
        >
          {name}
        </text>

        <text
          x={cx}
          y={cy + fontSize * 1.2}
          textAnchor="middle"
          fontSize={fontSize}
          fontWeight="500"
          fill={colors.stroke}
          aria-hidden="true"
        >
          {driftLabel}
        </text>
      </svg>

      {showTooltip && (
        <div
          role="tooltip"
          className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 w-48 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg p-3 text-xs pointer-events-none"
        >
          <p className="font-semibold text-gray-900 dark:text-white mb-1">{name}</p>
          <div className="space-y-1 text-gray-600 dark:text-gray-400">
            <div className="flex justify-between">
              <span>Current</span>
              <span className="font-medium text-gray-900 dark:text-white">{current.toFixed(2)}%</span>
            </div>
            <div className="flex justify-between">
              <span>Target</span>
              <span className="font-medium text-gray-900 dark:text-white">{target.toFixed(2)}%</span>
            </div>
            <div className="flex justify-between border-t border-gray-100 dark:border-gray-700 pt-1 mt-1">
              <span>Drift</span>
              <span className={`font-semibold ${colors.text}`}>{driftLabel}</span>
            </div>
            <div className="flex justify-between">
              <span>Threshold</span>
              <span className="font-medium text-gray-900 dark:text-white">±{threshold}%</span>
            </div>
          </div>
          <p className={`mt-2 text-[10px] font-medium ${colors.text}`}>{colors.label}</p>
        </div>
      )}

      <span
        className={`mt-1 text-xs font-medium ${colors.text}`}
        aria-hidden="true"
      >
        {driftLabel}
      </span>
    </div>
  )
}

export const DriftGaugeGrid: React.FC<DriftGaugeGridProps> = ({
  assets,
  title = 'Allocation Drift',
}) => {
  const [showBreakdown, setShowBreakdown] = useState(false)

  if (assets.length === 0) return null

  const sortedAssets = useMemo(() => {
    return [...assets].sort((a, b) => Math.abs(b.current - b.target) - Math.abs(a.current - a.target))
  }, [assets])

  const totalDrift = useMemo(() => {
    return assets.reduce((sum, a) => sum + Math.abs(a.current - a.target), 0)
  }, [assets])

  return (
    <section
      className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm"
      aria-labelledby="drift-gauge-heading"
    >
      <div
        className="relative inline-block"
        onMouseEnter={() => setShowBreakdown(true)}
        onMouseLeave={() => setShowBreakdown(false)}
        onFocus={() => setShowBreakdown(true)}
        onBlur={() => setShowBreakdown(false)}
      >
        <h3
          id="drift-gauge-heading"
          className="text-sm font-semibold text-gray-900 dark:text-white mb-4 cursor-default"
          tabIndex={0}
        >
          {title}
        </h3>

        {showBreakdown && (
          <div
            role="tooltip"
            className="absolute bottom-full mb-1 left-0 z-50 w-64 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg p-3 text-xs pointer-events-none"
          >
            <p className="font-semibold text-gray-900 dark:text-white mb-2">
              Drift Breakdown
            </p>
            <div className="space-y-1.5">
              {sortedAssets.map((a) => {
                const drift = a.current - a.target
                const absDrift = Math.abs(drift)
                const status = getDriftStatus(drift, a.threshold)
                const pctOfTotal = totalDrift > 0 ? ((absDrift / totalDrift) * 100).toFixed(0) : '0'
                return (
                  <div key={a.name} className="flex items-center justify-between">
                    <span className="text-gray-600 dark:text-gray-400">{a.name}</span>
                    <span className={`font-medium ${STATUS_COLORS[status].text}`}>
                      {drift >= 0 ? '+' : ''}{drift.toFixed(1)}%
                      <span className="text-gray-400 dark:text-gray-500 ml-1">
                        ({pctOfTotal}%)
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 flex justify-between text-gray-500 dark:text-gray-400">
              <span>Total absolute drift</span>
              <span className="font-medium text-gray-900 dark:text-white">{totalDrift.toFixed(1)}%</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4" aria-label="Color legend">
        {(Object.entries(STATUS_COLORS) as [DriftStatus, typeof STATUS_COLORS['ok']][]).map(
          ([, c]) => (
            <div key={c.label} className="flex items-center gap-1">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: c.stroke }}
                aria-hidden="true"
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">{c.label}</span>
            </div>
          )
        )}
      </div>

      <div
        className="flex flex-wrap gap-4 justify-start"
        role="list"
        aria-label="Drift gauges for all portfolio assets"
      >
        {assets.map((asset) => (
          <div key={asset.name} role="listitem">
            <DriftGauge asset={asset} size={96} />
          </div>
        ))}
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {assets.map((a) => {
          const drift = a.current - a.target
          const status = getDriftStatus(drift, a.threshold)
          return (
            <span key={a.name}>
              {a.name}: {drift >= 0 ? '+' : ''}{drift.toFixed(1)}% drift, {STATUS_COLORS[status].label}.{' '}
            </span>
          )
        })}
      </div>
    </section>
  )
}

export default DriftGauge
