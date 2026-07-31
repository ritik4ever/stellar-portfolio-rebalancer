import { DEFAULT_LOCALE } from '../content/uiCopy'

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
