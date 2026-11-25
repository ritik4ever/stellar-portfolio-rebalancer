// The upper bound keeps every seven-decimal token amount within the precision
// of the numeric API payload. Separators for digit grouping are not accepted.
export const MAX_DCA_AMOUNT = 200_000_000

export function decimalSeparator(locale: string): string {
  return new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.'
}

export function parseDcaAmount(input: string, locale: string): number | null {
  const separator = decimalSeparator(locale)
  const pieces = input.trim().split(separator)
  if (pieces.length > 2 || !/^\d+$/.test(pieces[0]) || (pieces.length === 2 && !/^\d{1,7}$/.test(pieces[1]))) return null
  const value = Number(pieces.join('.'))
  return Number.isFinite(value) && value >= 0.0000001 && value <= MAX_DCA_AMOUNT ? value : null
}

export function formatDcaAmount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 7 }).format(value)
}
