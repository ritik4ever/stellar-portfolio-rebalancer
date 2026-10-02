/**
 * Minimal 5x7 bitmap font used by the social-share card renderer.
 *
 * Social crawlers only accept raster images for `og:image`, and rasterising SVG
 * needs a native dependency (sharp / resvg / canvas) that the Alpine-based
 * production image cannot install. Drawing glyphs from a bitmap table keeps the
 * share card dependency-free: `backend/src/utils/png.ts` scales the rows by
 * whole pixels, so the output stays crisp instead of blurred.
 *
 * Each glyph is seven rows of five columns. A row is stored as a binary literal
 * where the leftmost column is the most significant bit.
 */

export const GLYPH_WIDTH = 5
export const GLYPH_HEIGHT = 7
/** Blank columns drawn between two glyphs. */
export const GLYPH_SPACING = 1

function parseGlyph(spec: string): number[] {
    const rows = spec.split(' ')
    if (rows.length !== GLYPH_HEIGHT) {
        throw new Error(`Glyph must have ${GLYPH_HEIGHT} rows, received ${rows.length}`)
    }
    return rows.map((row) => {
        if (row.length !== GLYPH_WIDTH) {
            throw new Error(`Glyph row must have ${GLYPH_WIDTH} columns, received "${row}"`)
        }
        return parseInt(row, 2)
    })
}

const GLYPHS: Record<string, number[]> = {
    ' ': parseGlyph('00000 00000 00000 00000 00000 00000 00000'),
    A: parseGlyph('01110 10001 10001 11111 10001 10001 10001'),
    B: parseGlyph('11110 10001 10001 11110 10001 10001 11110'),
    C: parseGlyph('01110 10001 10000 10000 10000 10001 01110'),
    D: parseGlyph('11100 10010 10001 10001 10001 10010 11100'),
    E: parseGlyph('11111 10000 10000 11110 10000 10000 11111'),
    F: parseGlyph('11111 10000 10000 11110 10000 10000 10000'),
    G: parseGlyph('01110 10001 10000 10111 10001 10001 01111'),
    H: parseGlyph('10001 10001 10001 11111 10001 10001 10001'),
    I: parseGlyph('01110 00100 00100 00100 00100 00100 01110'),
    J: parseGlyph('00111 00010 00010 00010 00010 10010 01100'),
    K: parseGlyph('10001 10010 10100 11000 10100 10010 10001'),
    L: parseGlyph('10000 10000 10000 10000 10000 10000 11111'),
    M: parseGlyph('10001 11011 10101 10101 10001 10001 10001'),
    N: parseGlyph('10001 11001 10101 10011 10001 10001 10001'),
    O: parseGlyph('01110 10001 10001 10001 10001 10001 01110'),
    P: parseGlyph('11110 10001 10001 11110 10000 10000 10000'),
    Q: parseGlyph('01110 10001 10001 10001 10101 10010 01101'),
    R: parseGlyph('11110 10001 10001 11110 10100 10010 10001'),
    S: parseGlyph('01111 10000 10000 01110 00001 00001 11110'),
    T: parseGlyph('11111 00100 00100 00100 00100 00100 00100'),
    U: parseGlyph('10001 10001 10001 10001 10001 10001 01110'),
    V: parseGlyph('10001 10001 10001 10001 10001 01010 00100'),
    W: parseGlyph('10001 10001 10001 10101 10101 11011 10001'),
    X: parseGlyph('10001 10001 01010 00100 01010 10001 10001'),
    Y: parseGlyph('10001 10001 01010 00100 00100 00100 00100'),
    Z: parseGlyph('11111 00001 00010 00100 01000 10000 11111'),
    '0': parseGlyph('01110 10001 10011 10101 11001 10001 01110'),
    '1': parseGlyph('00100 01100 00100 00100 00100 00100 01110'),
    '2': parseGlyph('01110 10001 00001 00010 00100 01000 11111'),
    '3': parseGlyph('11111 00010 00100 00010 00001 10001 01110'),
    '4': parseGlyph('00010 00110 01010 10010 11111 00010 00010'),
    '5': parseGlyph('11111 10000 11110 00001 00001 10001 01110'),
    '6': parseGlyph('00110 01000 10000 11110 10001 10001 01110'),
    '7': parseGlyph('11111 00001 00010 00100 01000 01000 01000'),
    '8': parseGlyph('01110 10001 10001 01110 10001 10001 01110'),
    '9': parseGlyph('01110 10001 10001 01111 00001 00010 01100'),
    '.': parseGlyph('00000 00000 00000 00000 00000 01100 01100'),
    ',': parseGlyph('00000 00000 00000 00000 00110 00100 01000'),
    ':': parseGlyph('00000 01100 01100 00000 01100 01100 00000'),
    '-': parseGlyph('00000 00000 00000 11111 00000 00000 00000'),
    '+': parseGlyph('00000 00100 00100 11111 00100 00100 00000'),
    '=': parseGlyph('00000 00000 11111 00000 11111 00000 00000'),
    '*': parseGlyph('00000 10101 01110 11111 01110 10101 00000'),
    '/': parseGlyph('00001 00010 00010 00100 01000 01000 10000'),
    '(': parseGlyph('00010 00100 01000 01000 01000 00100 00010'),
    ')': parseGlyph('01000 00100 00010 00010 00010 00100 01000'),
    '[': parseGlyph('01110 01000 01000 01000 01000 01000 01110'),
    ']': parseGlyph('01110 00010 00010 00010 00010 00010 01110'),
    '<': parseGlyph('00010 00100 01000 10000 01000 00100 00010'),
    '>': parseGlyph('01000 00100 00010 00001 00010 00100 01000'),
    '$': parseGlyph('00100 01111 10100 01110 00101 11110 00100'),
    '%': parseGlyph('11001 11010 00010 00100 01000 01011 10011'),
    '#': parseGlyph('01010 01010 11111 01010 11111 01010 01010'),
    '&': parseGlyph('01100 10010 10100 01000 10101 10010 01101'),
    '?': parseGlyph('01110 10001 00001 00010 00100 00000 00100'),
    '!': parseGlyph('00100 00100 00100 00100 00100 00000 00100'),
    "'": parseGlyph('00100 00100 00000 00000 00000 00000 00000'),
    '_': parseGlyph('00000 00000 00000 00000 00000 00000 11111'),
    '|': parseGlyph('00100 00100 00100 00100 00100 00100 00100'),
}

/** Glyph rows for a single character; unknown characters fall back to `?`. */
export function getGlyphRows(character: string): number[] {
    return GLYPHS[character] ?? GLYPHS['?']
}

/** Width in font pixels (before scaling) of one character plus its spacing. */
export function getGlyphAdvance(): number {
    return GLYPH_WIDTH + GLYPH_SPACING
}

/**
 * Uppercases, drops characters the font cannot draw and collapses whitespace so
 * that user-supplied strings (portfolio names, tickers) never leak raw
 * non-ASCII into the raster card.
 */
export function sanitizeText(value: string): string {
    if (typeof value !== 'string') return ''
    return value
        .toUpperCase()
        .replace(/[^A-Z0-9 .,:;=+*/()[\]<>&?!#$_|\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/** Width of `text` in device pixels once drawn at `scale`. */
export function measureTextWidth(text: string, scale: number): number {
    if (text.length === 0) return 0
    const step = getGlyphAdvance() * scale
    return text.length * step - GLYPH_SPACING * scale
}

/**
 * Shortens `text` so it fits `maxWidth`, appending an ellipsis when characters
 * are dropped. Returns an empty string when not even one character fits.
 */
export function fitText(text: string, scale: number, maxWidth: number): string {
    const step = getGlyphAdvance() * scale
    if (text.length === 0 || maxWidth < step) return ''
    const maxChars = Math.floor((maxWidth + GLYPH_SPACING * scale) / step)
    if (text.length <= maxChars) return text
    if (maxChars <= 3) return text.slice(0, maxChars)
    return `${text.slice(0, maxChars - 3)}...`
}