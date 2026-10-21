import { Canvas, parseHexColor, type Rgb } from '../utils/png.js'
import { fitText, sanitizeText } from '../utils/bitmapFont.js'

/**
 * Server-rendered Open Graph card for a shared portfolio.
 *
 * Sharing a public portfolio link currently yields the bare `index.html`
 * fallback everywhere except crawlers that execute JavaScript, and even then
 * without an image. This renders the portfolio's headline stats into a
 * 1200x630 PNG that `GET /portfolio/share/:hash/og.png` serves and
 * `PublicPortfolio.tsx` advertises as `og:image`.
 *
 * The card is drawn from the already-masked share payload, so no unmasked owner
 * address ever reaches the image.
 */

export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630
export const OG_IMAGE_CONTENT_TYPE = 'image/png'

/** Matches the allocation palette used by the frontend pie chart. */
export const OG_IMAGE_SEGMENT_COLORS = [
    '#3B82F6',
    '#10B981',
    '#F59E0B',
    '#EF4444',
    '#8B5CF6',
    '#EC4899',
] as const

const BRAND = 'Stellar Portfolio Rebalancer'
const MARGIN = 80
const CONTENT_WIDTH = OG_IMAGE_WIDTH - MARGIN * 2
const HEADER_HEIGHT = 140
const LEGEND_ROW_HEIGHT = 36
const LEGEND_COLUMNS = 2
const LEGEND_MAX_ENTRIES = 6

const COLORS = {
    background: parseHexColor('#F8FAFC'),
    headerFrom: parseHexColor('#2563EB'),
    headerTo: parseHexColor('#1E3A8A'),
    brand: parseHexColor('#BFDBFE'),
    headerBadge: parseHexColor('#93C5FD'),
    title: parseHexColor('#0F172A'),
    value: parseHexColor('#1D4ED8'),
    meta: parseHexColor('#475569'),
    legend: parseHexColor('#1E293B'),
    barTrack: parseHexColor('#E2E8F0'),
    divider: parseHexColor('#CBD5E1'),
} as const satisfies Record<string, Rgb>

export interface PortfolioOgCardInput {
    name?: string
    totalValue: number
    threshold?: number
    allocations?: Record<string, number>
    /** Already masked owner address, as returned by the public share view. */
    ownerAddress?: string
}

export interface AllocationSegment {
    asset: string
    /** Allocation weight exactly as stored on the portfolio. */
    weight: number
    /** `weight` as a share of the total allocation (sums to 100). */
    share: number
    color: string
}

function toFiniteNumber(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

/** `$100,000` — locale-independent so the rendered card is byte-stable. */
export function formatUsd(value: unknown): string {
    const numeric = toFiniteNumber(value)
    const sign = numeric < 0 ? '-' : ''
    const absolute = Math.abs(numeric)
    if (absolute >= 1e12) return formatUsdCompact(numeric)
    return `${sign}$${Math.round(absolute).toLocaleString('en-US')}`
}

/** `$1.25M` / `$12.3K` — used when the grouped value cannot fit the card. */
export function formatUsdCompact(value: unknown): string {
    const numeric = toFiniteNumber(value)
    const sign = numeric < 0 ? '-' : ''
    const absolute = Math.abs(numeric)
    if (absolute >= 1e12) return `${sign}$${(absolute / 1e12).toFixed(2)}T`
    if (absolute >= 1e9) return `${sign}$${(absolute / 1e9).toFixed(2)}B`
    if (absolute >= 1e6) return `${sign}$${(absolute / 1e6).toFixed(2)}M`
    if (absolute >= 1e3) return `${sign}$${(absolute / 1e3).toFixed(1)}K`
    return `${sign}$${Math.round(absolute).toLocaleString('en-US')}`
}

/** `50%` for whole weights, `33.3%` otherwise. */
export function formatAllocationPercent(weight: number): string {
    const value = toFiniteNumber(weight)
    const rounded = Math.round(value * 10) / 10
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

/**
 * Allocation weights as drawable segments: positive, finite, largest first and
 * colour-cycled. Weights keep their stored value (so the card matches the
 * portfolio page) while `share` drives the bar geometry.
 */
export function buildAllocationSegments(allocations?: Record<string, number>): AllocationSegment[] {
    if (!allocations || typeof allocations !== 'object') return []

    const entries = Object.entries(allocations)
        .map(([asset, weight]) => ({ asset: sanitizeText(asset), weight: toFiniteNumber(weight) }))
        .filter(entry => entry.asset.length > 0 && entry.weight > 0)

    const total = entries.reduce((sum, entry) => sum + entry.weight, 0)
    if (total <= 0) return []

    return entries
        .sort((a, b) => b.weight - a.weight || a.asset.localeCompare(b.asset))
        .map((entry, index) => ({
            asset: entry.asset,
            weight: entry.weight,
            share: (entry.weight / total) * 100,
            color: OG_IMAGE_SEGMENT_COLORS[index % OG_IMAGE_SEGMENT_COLORS.length],
        }))
}

/**
 * Geometry of the stacked allocation bar. Edges accumulate the segment shares
 * so the bar always spans the full content width without gaps from rounding.
 */
export function buildAllocationBar(
    segments: AllocationSegment[],
    x: number,
    width: number,
): Array<{ asset: string; x: number; width: number; color: string }> {
    let previousEdge = x
    let cumulative = 0
    return segments.map((segment, index) => {
        cumulative += segment.share
        const edge =
            index === segments.length - 1 ? x + width : x + Math.round((cumulative / 100) * width)
        const bar = { asset: segment.asset, x: previousEdge, width: edge - previousEdge, color: segment.color }
        previousEdge = edge
        return bar
    })
}

function valueTextScale(text: string): number {
    if (text.length <= 9) return 8
    if (text.length <= 13) return 6
    return 4
}

function summaryLine(input: PortfolioOgCardInput, assetCount: number): string {
    const parts: string[] = []
    parts.push(`${assetCount} asset${assetCount === 1 ? '' : 's'}`)
    const threshold = toFiniteNumber(input.threshold)
    if (threshold > 0) parts.push(`Rebalance threshold ${formatAllocationPercent(threshold)}`)
    const owner = sanitizeText(input.ownerAddress ?? '')
    if (owner) parts.push(`Shared by ${owner}`)
    return parts.join(' / ')
}

/** Renders the share card as PNG bytes. */
export function renderPortfolioOgCard(input: PortfolioOgCardInput): Buffer {
    const canvas = new Canvas(OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, COLORS.background)
    const segments = buildAllocationSegments(input.allocations)

    canvas.fillGradientRect(0, 0, OG_IMAGE_WIDTH, HEADER_HEIGHT, COLORS.headerFrom, COLORS.headerTo)
    canvas.drawText(BRAND, MARGIN, 58, { scale: 3, color: COLORS.brand })

    const badge = 'Shared portfolio'
    canvas.drawText(badge, OG_IMAGE_WIDTH - MARGIN - canvas.measureText(badge.toUpperCase(), 3), 58, {
        scale: 3,
        color: COLORS.headerBadge,
    })

    const title = sanitizeText(input.name ?? '') || 'Portfolio snapshot'
    canvas.drawText(title, MARGIN, 180, { scale: 6, color: COLORS.title, maxWidth: CONTENT_WIDTH })

    const value = formatUsd(input.totalValue)
    canvas.drawText(value, MARGIN, 248, {
        scale: valueTextScale(value),
        color: COLORS.value,
        maxWidth: CONTENT_WIDTH,
    })

    canvas.drawText(summaryLine(input, segments.length), MARGIN, 340, {
        scale: 3,
        color: COLORS.meta,
        maxWidth: CONTENT_WIDTH,
    })

    const barY = 400
    const barHeight = 56
    canvas.fillRect(MARGIN, barY, CONTENT_WIDTH, barHeight, COLORS.barTrack)
    if (segments.length > 0) {
        for (const bar of buildAllocationBar(segments, MARGIN, CONTENT_WIDTH)) {
            canvas.fillRect(bar.x, barY, bar.width, barHeight, parseHexColor(bar.color))
        }
    } else {
        canvas.drawText('No allocation data', MARGIN + 16, barY + 20, { scale: 3, color: COLORS.meta })
    }

    canvas.fillRect(MARGIN, barY + barHeight + 22, CONTENT_WIDTH, 2, COLORS.divider)

    const visible = segments.slice(0, LEGEND_MAX_ENTRIES)
    visible.forEach((segment, index) => {
        const column = index % LEGEND_COLUMNS
        const row = Math.floor(index / LEGEND_COLUMNS)
        const x = MARGIN + column * (CONTENT_WIDTH / LEGEND_COLUMNS)
        const y = 510 + row * LEGEND_ROW_HEIGHT
        canvas.fillRect(x, y + 2, 22, 22, parseHexColor(segment.color))
        const label = fitText(
            `${segment.asset} ${formatAllocationPercent(segment.weight)}`,
            3,
            CONTENT_WIDTH / LEGEND_COLUMNS - 48,
        )
        canvas.drawText(label, x + 34, y, { scale: 3, color: COLORS.legend })
    })

    const hidden = segments.length - visible.length
    if (hidden > 0) {
        const overflowColumn = visible.length % LEGEND_COLUMNS
        const overflowRow = Math.floor(visible.length / LEGEND_COLUMNS)
        canvas.drawText(
            `+${hidden} more`,
            MARGIN + overflowColumn * (CONTENT_WIDTH / LEGEND_COLUMNS),
            510 + overflowRow * LEGEND_ROW_HEIGHT,
            { scale: 3, color: COLORS.meta },
        )
    }

    return canvas.toPng()
}