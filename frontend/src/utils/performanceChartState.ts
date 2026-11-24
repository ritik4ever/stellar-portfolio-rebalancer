/**
 * Pure helpers for the Performance chart's edge states: an empty series, a single price point,
 * and assets whose historical prices are missing from some snapshots.
 */

export interface AnalyticsSnapshotLike {
  timestamp?: unknown
  totalValue?: unknown
  allocations?: Record<string, unknown> | null
}

export interface MissingAssetHistory {
  asset: string
  /** snapshots in the range with no usable value for this asset */
  missingPoints: number
  /** snapshots in the range that report per-asset data at all */
  totalPoints: number
}

export type ChartDataState = 'empty' | 'single' | 'series'

export function chartDataState(pointCount: number): ChartDataState {
  if (pointCount <= 0) return 'empty'
  if (pointCount === 1) return 'single'
  return 'series'
}

function hasUsableValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n)
}

/**
 * Assets that appear in the range but lack a usable value in at least one snapshot. Only snapshots that
 * report `allocations` are considered, so a backend that sends no per-asset data never raises a warning.
 * Sorted by most missing points first, then by asset name.
 */
export function findAssetsMissingHistory(snapshots: readonly AnalyticsSnapshotLike[] | null | undefined): MissingAssetHistory[] {
  const withAllocations = (snapshots ?? []).filter(
    (s): s is AnalyticsSnapshotLike & { allocations: Record<string, unknown> } =>
      !!s && typeof s.allocations === 'object' && s.allocations !== null,
  )
  if (withAllocations.length === 0) return []

  const assets = new Set<string>()
  for (const s of withAllocations) {
    for (const key of Object.keys(s.allocations)) assets.add(key)
  }

  const out: MissingAssetHistory[] = []
  for (const asset of assets) {
    const missingPoints = withAllocations.filter((s) => !hasUsableValue(s.allocations[asset])).length
    if (missingPoints > 0) out.push({ asset, missingPoints, totalPoints: withAllocations.length })
  }
  return out.sort((a, b) => b.missingPoints - a.missingPoints || a.asset.localeCompare(b.asset))
}

/** A stable key for a set of missing assets, so a dismissal applies to that exact set only. */
export function missingHistoryKey(range: string, missing: readonly MissingAssetHistory[]): string {
  return `${range}:${missing.map((m) => `${m.asset}=${m.missingPoints}/${m.totalPoints}`).join(',')}`
}
