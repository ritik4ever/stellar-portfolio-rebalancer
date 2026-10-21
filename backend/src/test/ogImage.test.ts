import { describe, it, expect } from 'vitest'
import { Canvas, parseHexColor } from '../utils/png.js'
import { fitText, measureTextWidth, sanitizeText } from '../utils/bitmapFont.js'
import {
    OG_IMAGE_HEIGHT,
    OG_IMAGE_WIDTH,
    buildAllocationBar,
    buildAllocationSegments,
    formatAllocationPercent,
    formatUsd,
    formatUsdCompact,
    renderPortfolioOgCard,
} from '../services/ogImage.js'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CARD = {
    name: 'Alpha Fund',
    totalValue: 123456.78,
    threshold: 5,
    allocations: { BTC: 50, ETH: 30, XLM: 20 },
    ownerAddress: 'GABC...WXYZ',
}

function readIhdr(png: Buffer): { width: number; height: number } {
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

describe('parseHexColor', () => {
    it('parses short and long form', () => {
        expect(parseHexColor('#ffffff')).toEqual({ r: 255, g: 255, b: 255 })
        expect(parseHexColor('2563EB')).toEqual({ r: 37, g: 99, b: 235 })
        expect(parseHexColor('#abc')).toEqual({ r: 170, g: 187, b: 204 })
    })

    it('rejects malformed values', () => {
        expect(() => parseHexColor('#zzzzzz')).toThrow(/Invalid hex colour/)
        expect(() => parseHexColor('')).toThrow(/Invalid hex colour/)
    })
})

describe('Canvas', () => {
    it('rejects non-positive or fractional dimensions', () => {
        expect(() => new Canvas(0, 10)).toThrow(/positive integers/)
        expect(() => new Canvas(10, 10.5)).toThrow(/positive integers/)
    })

    it('fills the background and clips rectangles to the surface', () => {
        const canvas = new Canvas(10, 10, { r: 1, g: 2, b: 3 })
        expect(canvas.getPixel(0, 0)).toEqual({ r: 1, g: 2, b: 3 })

        canvas.fillRect(-5, -5, 8, 8, { r: 255, g: 255, b: 255 })
        expect(canvas.getPixel(0, 0)).toEqual({ r: 255, g: 255, b: 255 })
        expect(canvas.getPixel(7, 7)).toEqual({ r: 1, g: 2, b: 3 })
        expect(canvas.getPixel(-1, 0)).toBeNull()
        expect(canvas.getPixel(10, 10)).toBeNull()
    })

    it('clamps out-of-range colour channels', () => {
        const canvas = new Canvas(2, 2, { r: 0, g: 0, b: 0 })
        canvas.fillRect(0, 0, 1, 1, { r: -20, g: 999, b: 12.6 })
        expect(canvas.getPixel(0, 0)).toEqual({ r: 0, g: 255, b: 13 })
    })

    it('interpolates a horizontal gradient across the requested rect only', () => {
        const canvas = new Canvas(10, 2, { r: 0, g: 0, b: 0 })
        canvas.fillGradientRect(2, 0, 6, 2, { r: 0, g: 0, b: 0 }, { r: 100, g: 100, b: 100 })

        expect(canvas.getPixel(1, 0)).toEqual({ r: 0, g: 0, b: 0 })
        expect(canvas.getPixel(2, 0)).toEqual({ r: 0, g: 0, b: 0 })
        expect(canvas.getPixel(7, 0)).toEqual({ r: 100, g: 100, b: 100 })
        expect(canvas.getPixel(8, 0)).toEqual({ r: 0, g: 0, b: 0 })
    })

    it('draws scaled text and reports the width it painted', () => {
        const canvas = new Canvas(60, 20, { r: 0, g: 0, b: 0 })
        const width = canvas.drawText('AB', 0, 0, { scale: 2, color: { r: 255, g: 255, b: 255 } })

        expect(width).toBe(22)
        expect(canvas.measureText('AB', 2)).toBe(22)
        /** 'A' opens with a 1-0-1-1-0 top row; 'B' with 1-1-1-1-0. */
        expect(canvas.getPixel(2, 0)).toEqual({ r: 255, g: 255, b: 255 })
        expect(canvas.getPixel(12, 0)).toEqual({ r: 255, g: 255, b: 255 })
        /** Last row of 'A' lights its outermost columns. */
        expect(canvas.getPixel(0, 12)).toEqual({ r: 255, g: 255, b: 255 })
        expect(canvas.getPixel(20, 0)).toEqual({ r: 0, g: 0, b: 0 })
        expect(canvas.getPixel(25, 0)).toEqual({ r: 0, g: 0, b: 0 })
        expect(canvas.measureText('AB', 1) * 2).toBe(measureTextWidth('AB', 2))
    })

    it('drops text it cannot draw and truncates to maxWidth', () => {
        const canvas = new Canvas(120, 20, { r: 0, g: 0, b: 0 })

        expect(canvas.drawText('☕', 0, 0, { scale: 1, color: { r: 255, g: 255, b: 255 } })).toBe(0)
        const truncated = canvas.drawText('ABCDEFGHIJ', 0, 0, {
            scale: 1,
            color: { r: 255, g: 255, b: 255 },
            maxWidth: 30,
        })
        expect(truncated).toBe(29)
    })

    it('serialises a decodable PNG header', () => {
        const png = new Canvas(4, 3, { r: 10, g: 20, b: 30 }).toPng()
        expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE)
        expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR')
        expect(readIhdr(png)).toEqual({ width: 4, height: 3 })
        expect(png.includes(Buffer.from('IEND', 'ascii'))).toBe(true)
    })
})

describe('bitmapFont helpers', () => {
    it('uppercases, collapses whitespace and strips undrawable characters', () => {
        expect(sanitizeText('  btc/xlm  ')).toBe('BTC/XLM')
        expect(sanitizeText('Café')).toBe('CAF')
        expect(sanitizeText('')).toBe('')
    })

    it('measures and truncates by advance width', () => {
        expect(measureTextWidth('', 2)).toBe(0)
        expect(measureTextWidth('A', 1)).toBe(5)
        expect(fitText('ABCDEFGHIJ', 1, 60)).toBe('ABCDEFGHIJ')
        expect(fitText('ABCDEFGHIJ', 1, 30)).toBe('AB...')
        expect(fitText('ABCDEFGHIJ', 1, 2)).toBe('')
    })
})

describe('ogImage formatting', () => {
    it('formats USD without locale drift', () => {
        expect(formatUsd(100000)).toBe('$100,000')
        expect(formatUsd(123456.78)).toBe('$123,457')
        expect(formatUsd(0)).toBe('$0')
        expect(formatUsd(Number.NaN)).toBe('$0')
        expect(formatUsd(-2500)).toBe('-$2,500')
        expect(formatUsd(5e12)).toBe('$5.00T')
    })

    it('formats compact USD above a thousand', () => {
        expect(formatUsdCompact(1250)).toBe('$1.3K')
        expect(formatUsdCompact(2500000)).toBe('$2.50M')
        expect(formatUsdCompact(3100000000)).toBe('$3.10B')
        expect(formatUsdCompact(2e12)).toBe('$2.00T')
        expect(formatUsdCompact(12)).toBe('$12')
    })

    it('formats allocation percentages at readable precision', () => {
        expect(formatAllocationPercent(50)).toBe('50%')
        expect(formatAllocationPercent(33.333)).toBe('33.3%')
        expect(formatAllocationPercent(Number.NaN)).toBe('0%')
    })
})

describe('buildAllocationSegments', () => {
    it('sorts largest first, normalises shares and cycles colours', () => {
        const segments = buildAllocationSegments({ XLM: 20, BTC: 50, ETH: 30 })

        expect(segments.map(segment => segment.asset)).toEqual(['BTC', 'ETH', 'XLM'])
        expect(segments.map(segment => segment.weight)).toEqual([50, 30, 20])
        expect(segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(100, 6)
        expect(segments.map(segment => segment.color)).toEqual(['#3B82F6', '#10B981', '#F59E0B'])
    })

    it('breaks ties deterministically and wraps the palette', () => {
        const segments = buildAllocationSegments({ XLM: 10, BTC: 10, ETH: 10, SOL: 10, ADA: 10, DOGE: 10 })
        expect(segments.map(segment => segment.asset)).toEqual(['ADA', 'BTC', 'DOGE', 'ETH', 'SOL', 'XLM'])
        expect(segments[5].color).toBe('#EC4899')
    })

    it('ignores unusable allocations', () => {
        expect(buildAllocationSegments(undefined)).toEqual([])
        expect(buildAllocationSegments({})).toEqual([])
        expect(buildAllocationSegments({ BTC: 0, ETH: -5 })).toEqual([])
        expect(buildAllocationSegments({ '   ': 10 })).toEqual([])
    })

    it('normalises weights that do not add up to 100', () => {
        const segments = buildAllocationSegments({ BTC: 45, ETH: 45 })
        expect(segments[0].weight).toBe(45)
        expect(segments[0].share).toBeCloseTo(50, 6)
    })
})

describe('buildAllocationBar', () => {
    it('lays segments out left to right without gaps and spans the full width', () => {
        const segments = buildAllocationSegments({ BTC: 50, ETH: 30, XLM: 15, SOL: 3, USDC: 2 })
        const bar = buildAllocationBar(segments, 80, 1040)

        expect(bar[0]).toEqual({ asset: 'BTC', x: 80, width: 520, color: '#3B82F6' })
        for (let index = 1; index < bar.length; index += 1) {
            expect(bar[index].x).toBe(bar[index - 1].x + bar[index - 1].width)
        }
        expect(bar[bar.length - 1].x + bar[bar.length - 1].width).toBe(1120)
        expect(bar.every((entry) => entry.width > 0)).toBe(true)
        expect(bar.reduce((sum, entry) => sum + entry.width, 0)).toBe(1040)
    })

    it('returns nothing when there is no allocation to draw', () => {
        expect(buildAllocationBar([], 80, 1040)).toEqual([])
    })
})

describe('renderPortfolioOgCard', () => {
    it('renders a 1200x630 PNG', () => {
        const png = renderPortfolioOgCard(CARD)
        expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE)
        expect(readIhdr(png)).toEqual({ width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT })
    })

    it('is deterministic for the same portfolio and differs between portfolios', () => {
        expect(renderPortfolioOgCard(CARD).equals(renderPortfolioOgCard(CARD))).toBe(true)
        expect(renderPortfolioOgCard(CARD).equals(renderPortfolioOgCard({ ...CARD, totalValue: 999 }))).toBe(false)
    })

    it('still renders when the portfolio has no usable allocation data', () => {
        const png = renderPortfolioOgCard({ totalValue: 0 })
        expect(readIhdr(png)).toEqual({ width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT })
    })
})