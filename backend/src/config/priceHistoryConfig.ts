/**
 * Price-history backfill settings, loaded from the environment and validated
 * with documented fallbacks.
 *
 * PRICE_HISTORY_BACKFILL_DAYS controls how many days of historical price
 * points are fetched for a newly added asset. Valid range is 1–365 days;
 * the default is 90 days of daily history. Values outside the range fall
 * back to the default so a malformed deploy cannot trigger an unbounded
 * (or empty) history request.
 */

export interface PriceHistoryConfig {
    /** Maximum number of days of price history to backfill per asset. */
    backfillDays: number
}

export const PRICE_HISTORY_BACKFILL_DEFAULT_DAYS = 90
export const PRICE_HISTORY_BACKFILL_MIN_DAYS = 1
export const PRICE_HISTORY_BACKFILL_MAX_DAYS = 365

export function parsePriceHistoryConfig(
    env: NodeJS.ProcessEnv = process.env,
): { config: PriceHistoryConfig; errors: string[] } {
    const errors: string[] = []

    const raw = env.PRICE_HISTORY_BACKFILL_DAYS?.trim()
    let backfillDays = PRICE_HISTORY_BACKFILL_DEFAULT_DAYS

    if (raw !== undefined && raw !== '') {
        const parsed = Number.parseInt(raw, 10)
        if (!Number.isInteger(parsed)) {
            errors.push(
                `PRICE_HISTORY_BACKFILL_DAYS '${raw}' is invalid. Provide an integer between ` +
                    `${PRICE_HISTORY_BACKFILL_MIN_DAYS} and ${PRICE_HISTORY_BACKFILL_MAX_DAYS}.`,
            )
        } else if (parsed < PRICE_HISTORY_BACKFILL_MIN_DAYS) {
            errors.push(
                `PRICE_HISTORY_BACKFILL_DAYS '${raw}' is below the minimum of ` +
                    `${PRICE_HISTORY_BACKFILL_MIN_DAYS} day(s).`,
            )
        } else if (parsed > PRICE_HISTORY_BACKFILL_MAX_DAYS) {
            errors.push(
                `PRICE_HISTORY_BACKFILL_DAYS '${raw}' exceeds the maximum of ` +
                    `${PRICE_HISTORY_BACKFILL_MAX_DAYS} day(s).`,
            )
        } else {
            backfillDays = parsed
        }
    }

    return { config: { backfillDays }, errors }
}

export function getPriceHistoryConfig(
    env: NodeJS.ProcessEnv = process.env,
): PriceHistoryConfig {
    return parsePriceHistoryConfig(env).config
}