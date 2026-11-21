const MAX_REFLECTOR_INTEGER = '170141183460469231731687303715884105727'

export interface NormalizedScaledQuote {
    price: number
    units: string
    decimals: number
}

export function normalizeScaledQuote(raw: string | number | bigint, decimals: number): NormalizedScaledQuote {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
        throw new TypeError('Invalid Reflector price scale')
    }
    if (typeof raw === 'number' && Number.isInteger(raw) && !Number.isSafeInteger(raw)) {
        throw new RangeError('Unsafe Reflector integer')
    }
    if (typeof raw !== 'number' && typeof raw !== 'string' && typeof raw !== 'bigint') {
        throw new TypeError('Invalid Reflector price value')
    }

    const digits = raw.toString().trim()
    if (!/^\d+$/.test(digits)) {
        const price = Number(digits)
        if (decimals === 0 && /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(digits)
            && Number.isFinite(price) && price > 0) {
            if (Number.isInteger(price) && !Number.isSafeInteger(price)) {
                throw new RangeError('Unsafe Reflector integer')
            }
            return { price, units: digits, decimals }
        }
        throw new TypeError('Invalid Reflector price value')
    }

    const units = digits.replace(/^0+/, '')
    if (!units) throw new TypeError('Invalid Reflector price value')
    if (units.length > MAX_REFLECTOR_INTEGER.length
        || (units.length === MAX_REFLECTOR_INTEGER.length && units > MAX_REFLECTOR_INTEGER)) {
        throw new RangeError('Reflector integer exceeds i128 range')
    }
    const price = Number(`${units}e-${decimals}`)

    const [coefficient, exponent] = price.toExponential().split('e')
    const significantDigits = coefficient.replace('.', '')
    const zeroCount = Number(exponent) + decimals - significantDigits.length + 1
    if (zeroCount < 0 || significantDigits + '0'.repeat(zeroCount) !== units) {
        throw new RangeError('Reflector price loses integer units')
    }

    return { price, units, decimals }
}
