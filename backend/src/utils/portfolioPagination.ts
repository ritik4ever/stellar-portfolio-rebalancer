export interface PortfolioPageCursor {
    createdAt: string
    id: string
}

export interface PortfolioPaginationResult<T = unknown> {
    portfolios: T[]
    limit: number
    cursor: string | null
    nextCursor: string | null
    count: number
    total: number
}

/**
 * Encode a portfolio pagination cursor into a URL-safe base64 string.
 */
export function encodePortfolioCursor(cursor: PortfolioPageCursor): string {
    const payload = JSON.stringify({
        createdAt: cursor.createdAt,
        id: cursor.id,
    })
    return Buffer.from(payload, 'utf8').toString('base64url')
}

/**
 * Decode and validate a portfolio pagination cursor.
 * Returns null if the cursor is malformed or invalid.
 */
export function decodePortfolioCursor(raw: string): PortfolioPageCursor | null {
    if (!raw || typeof raw !== 'string') return null
    const trimmed = raw.trim()
    if (!trimmed) return null

    // 1. Try base64url / base64 decoded JSON
    try {
        const decodedStr = Buffer.from(trimmed, 'base64').toString('utf8')
        if (decodedStr.startsWith('{') && decodedStr.endsWith('}')) {
            const parsed = JSON.parse(decodedStr)
            if (
                parsed &&
                typeof parsed === 'object' &&
                typeof parsed.createdAt === 'string' &&
                typeof parsed.id === 'string' &&
                parsed.id.length > 0 &&
                !Number.isNaN(Date.parse(parsed.createdAt))
            ) {
                return {
                    createdAt: new Date(parsed.createdAt).toISOString(),
                    id: parsed.id,
                }
            }
        }
    } catch {
        // Fall through to alternative parsing formats
    }

    // 2. Try raw JSON
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const parsed = JSON.parse(trimmed)
            if (
                parsed &&
                typeof parsed === 'object' &&
                typeof parsed.createdAt === 'string' &&
                typeof parsed.id === 'string' &&
                parsed.id.length > 0 &&
                !Number.isNaN(Date.parse(parsed.createdAt))
            ) {
                return {
                    createdAt: new Date(parsed.createdAt).toISOString(),
                    id: parsed.id,
                }
            }
        } catch {
            // Fall through
        }
    }

    // 3. Try "createdAt_id" or "createdAt:id"
    const delimiter = trimmed.includes('__') ? '__' : (trimmed.includes('_') ? '_' : (trimmed.includes(':') ? ':' : null))
    if (delimiter) {
        const splitIndex = trimmed.lastIndexOf(delimiter)
        const datePart = trimmed.slice(0, splitIndex)
        const idPart = trimmed.slice(splitIndex + delimiter.length)
        if (datePart && idPart && !Number.isNaN(Date.parse(datePart))) {
            return {
                createdAt: new Date(datePart).toISOString(),
                id: idPart,
            }
        }
    }

    return null
}
