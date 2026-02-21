import type { UIAllocation } from '../types/index.js'

/**
 * allocation format (`Record<string, number>`).
 */
export function isStoredAllocations(v: unknown): v is Record<string, number> {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
    return Object.values(v as object).every(x => typeof x === 'number')
}

/**
 * @example
 * // From stored portfolio
 * toStoredAllocations({ XLM: 40, BTC: 30, ETH: 20, USDC: 10 })
 * // → { XLM: 40, BTC: 30, ETH: 20, USDC: 10 }
 *
 * @example
 * // From UI response
 * toStoredAllocations([{ asset: 'XLM', target: 40, current: 38 }])
 * // → { XLM: 40 }
 */
export function toStoredAllocations(
    input: Record<string, number> | UIAllocation[]
): Record<string, number> {
    if (Array.isArray(input)) {
        const result: Record<string, number> = {}
        for (const item of input) {
            if (typeof item.asset === 'string') {
                result[item.asset] = item.target
            }
        }
        return result
    }
    return { ...input }
}
