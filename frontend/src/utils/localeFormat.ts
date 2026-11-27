import { DEFAULT_LOCALE } from '../content/uiCopy'

/**
 * Parse a localized numeric string entered by the user and return the
 * canonical floating-point value in token units.
 *
 * Handles decimal-comma locales (de-DE, fr-FR, pt-BR …) where the user
 * types "1.234,56" or "1 234,56" instead of "1,234.56".
 *
 * Returns `NaN` for strings that cannot be resolved to a finite number so
 * that call sites can gate on `Number.isFinite(result)` and show an error.
 *
 * @param raw    - The raw string value from the input element.
 * @param locale - BCP 47 locale tag that describes the decimal / grouping
 *                 separators in `raw`.  Defaults to `en-US`.
 */
export function parseLocalizedAmount(raw: string, locale = DEFAULT_LOCALE): number {
    if (!raw || !raw.trim()) return NaN

    // Resolve locale-specific separators via Intl.NumberFormat.
    const parts = new Intl.NumberFormat(locale).formatToParts(1234567.89)
    const groupSep = parts.find((p) => p.type === 'group')?.value ?? ','
    const decimalSep = parts.find((p) => p.type === 'decimal')?.value ?? '.'

    // Strip grouping separators then replace the decimal separator with '.'.
    const normalized = raw
        .trim()
        .split(groupSep)
        .join('')
        .split(decimalSep)
        .join('.')

    const result = Number(normalized)
    return Number.isFinite(result) ? result : NaN
}

export function formatUsd(
    value: number,
    options?: Intl.NumberFormatOptions,
): string {
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        ...options,
    }).format(value)
}

export function formatUsdCompact(value: number): string {
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value)
}

export function formatPercent(value: number, digits = 2): string {
    const sign = value >= 0 ? '+' : ''
    return `${sign}${value.toFixed(digits)}%`
}

export function formatNumber(value: number): string {
    return new Intl.NumberFormat(DEFAULT_LOCALE).format(value)
}

export function formatShortDate(isoOrDate?: string | Date | null): string {
    if (!isoOrDate) return '—'
    const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '—'
    return date.toLocaleDateString(DEFAULT_LOCALE, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    })
}

export function formatTime(isoOrDate?: string | Date | null): string {
    if (!isoOrDate) return '—'
    const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '—'
    return date.toLocaleTimeString(DEFAULT_LOCALE, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
    })
}
