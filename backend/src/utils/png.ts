import { deflateSync } from 'node:zlib'
import {
    GLYPH_HEIGHT,
    GLYPH_WIDTH,
    fitText,
    getGlyphAdvance,
    getGlyphRows,
    measureTextWidth,
    sanitizeText,
} from './bitmapFont.js'

/**
 * Dependency-free truecolour PNG writer.
 *
 * Social crawlers reject SVG for `og:image`, and rasterising SVG would mean a
 * native dependency the Alpine production image cannot install. Everything the
 * share card needs — solid fills, a horizontal gradient, and scaled bitmap text
 * — is a handful of pixel writes, so the image is composed straight into an
 * RGB buffer and serialised here.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
    const table = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
        let c = n
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        }
        table[n] = c
    }
    return table
})()

export interface Rgb {
    r: number
    g: number
    b: number
}

function crc32(data: Buffer): number {
    let crc = -1
    for (let i = 0; i < data.length; i += 1) {
        crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ -1) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length, 0)
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typeAndData), 0)
    return Buffer.concat([length, typeAndData, crc])
}

/** Parses `#rgb` / `#rrggbb` into channel values. */
export function parseHexColor(hex: string): Rgb {
    const normalized = hex.trim().replace(/^#/, '')
    const full = normalized.length === 3 ? normalized.split('').map(c => c + c).join('') : normalized
    if (!/^[0-9a-f]{6}$/i.test(full)) {
        throw new Error(`Invalid hex colour: ${hex}`)
    }
    return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16),
    }
}

function clampChannel(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.min(255, Math.max(0, Math.round(value)))
}

export interface TextOptions {
    scale: number
    color: Rgb
    /** Hard width limit in device pixels; longer strings are truncated. */
    maxWidth?: number
}

/** An RGB raster surface with the drawing primitives the share card needs. */
export class Canvas {
    readonly width: number
    readonly height: number
    private readonly pixels: Buffer

    constructor(width: number, height: number, background: Rgb = { r: 255, g: 255, b: 255 }) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
            throw new Error(`Canvas dimensions must be positive integers, received ${width}x${height}`)
        }
        this.width = width
        this.height = height
        this.pixels = Buffer.alloc(width * height * 3)
        this.fill(background)
    }

    fill(color: Rgb): void {
        const { r, g, b } = color
        for (let offset = 0; offset < this.pixels.length; offset += 3) {
            this.pixels[offset] = r
            this.pixels[offset + 1] = g
            this.pixels[offset + 2] = b
        }
    }

    /** Channel value at a pixel, or `null` outside the canvas. Test helper. */
    getPixel(x: number, y: number): Rgb | null {
        const px = Math.round(x)
        const py = Math.round(y)
        if (px < 0 || py < 0 || px >= this.width || py >= this.height) return null
        const offset = (py * this.width + px) * 3
        return { r: this.pixels[offset], g: this.pixels[offset + 1], b: this.pixels[offset + 2] }
    }

    fillRect(x: number, y: number, rectWidth: number, rectHeight: number, color: Rgb): void {
        const r = clampChannel(color.r)
        const g = clampChannel(color.g)
        const b = clampChannel(color.b)
        const x0 = Math.max(0, Math.round(x))
        const y0 = Math.max(0, Math.round(y))
        const x1 = Math.min(this.width, Math.round(x + rectWidth))
        const y1 = Math.min(this.height, Math.round(y + rectHeight))
        for (let py = y0; py < y1; py += 1) {
            for (let px = x0; px < x1; px += 1) {
                const offset = (py * this.width + px) * 3
                this.pixels[offset] = r
                this.pixels[offset + 1] = g
                this.pixels[offset + 2] = b
            }
        }
    }

    /** Left-to-right two-stop gradient, clipped to the canvas. */
    fillGradientRect(
        x: number,
        y: number,
        rectWidth: number,
        rectHeight: number,
        from: Rgb,
        to: Rgb,
    ): void {
        const x0 = Math.max(0, Math.round(x))
        const y0 = Math.max(0, Math.round(y))
        const x1 = Math.min(this.width, Math.round(x + rectWidth))
        const y1 = Math.min(this.height, Math.round(y + rectHeight))
        const span = Math.max(1, x1 - x0 - 1)
        for (let px = x0; px < x1; px += 1) {
            const t = (px - x0) / span
            this.fillRect(px, y0, 1, y1 - y0, {
                r: from.r + (to.r - from.r) * t,
                g: from.g + (to.g - from.g) * t,
                b: from.b + (to.b - from.b) * t,
            })
        }
    }

    measureText(text: string, scale: number): number {
        return measureTextWidth(sanitizeText(text), scale)
    }

    /** Draws text with its top-left corner at (x, y); returns the width drawn. */
    drawText(text: string, x: number, y: number, options: TextOptions): number {
        const scale = Math.max(1, Math.round(options.scale))
        const r = clampChannel(options.color.r)
        const g = clampChannel(options.color.g)
        const b = clampChannel(options.color.b)
        let value = sanitizeText(text)
        if (options.maxWidth !== undefined) {
            value = fitText(value, scale, options.maxWidth)
        }
        if (value.length === 0) return 0

        const originX = Math.round(x)
        const originY = Math.round(y)
        const advance = getGlyphAdvance() * scale

        for (let index = 0; index < value.length; index += 1) {
            const rows = getGlyphRows(value[index])
            const glyphX = originX + index * advance
            for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
                const bits = rows[row]
                for (let col = 0; col < GLYPH_WIDTH; col += 1) {
                    const lit = (bits >> (GLYPH_WIDTH - 1 - col)) & 1
                    if (!lit) continue
                    this.fillRect(glyphX + col * scale, originY + row * scale, scale, scale, { r, g, b })
                }
            }
        }

        return value.length * advance - scale
    }

    /** Device height of a text run at `scale`. */
    static textHeight(scale: number): number {
        return GLYPH_HEIGHT * Math.max(1, Math.round(scale))
    }

    toPng(): Buffer {
        const stride = this.width * 3
        const raw = Buffer.alloc((stride + 1) * this.height)
        for (let y = 0; y < this.height; y += 1) {
            const rowStart = y * (stride + 1)
            raw[rowStart] = 0
            this.pixels.copy(raw, rowStart + 1, y * stride, (y + 1) * stride)
        }

        const ihdr = Buffer.alloc(13)
        ihdr.writeUInt32BE(this.width, 0)
        ihdr.writeUInt32BE(this.height, 4)
        ihdr[8] = 8
        ihdr[9] = 2
        const idat = deflateSync(raw)

        return Buffer.concat([
            PNG_SIGNATURE,
            chunk('IHDR', ihdr),
            chunk('IDAT', idat),
            chunk('IEND', Buffer.alloc(0)),
        ])
    }
}