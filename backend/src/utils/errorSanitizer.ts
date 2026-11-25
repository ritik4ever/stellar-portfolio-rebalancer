/**
 * Sanitizes error payloads before they are serialized into an API response.
 *
 * Upstream failures (database drivers, the Stellar RPC, the Reflector oracle,
 * HTTP clients) frequently embed connection strings, API keys or bearer tokens
 * in their `message`. Those messages end up in the error envelope verbatim via
 * `fail(res, 500, 'INTERNAL_ERROR', getErrorMessage(error))`, which leaks
 * credentials to the caller. The logger already redacts secrets
 * (`secretRedactor`), but the response path did not — this module closes that
 * gap.
 *
 * The policy is deliberately narrow: messages keep their wording so operator
 * facing hints (for example "ALLOW_FALLBACK_PRICES is disabled") survive, only
 * the credential *values* are replaced. Stack frames and error stacks are
 * dropped because they expose internal file paths.
 */

import { isSensitiveKey, redactString } from './secretRedactor.js'

export const REDACTED_HINT = '[REDACTED]'

/**
 * Keys whose assigned value is a secret. Matched against the key only, so a
 * message that merely mentions a word (e.g. "Invalid token") is untouched.
 */
const SENSITIVE_ASSIGNMENT_KEYS = [
    'password',
    'passwd',
    'pwd',
    'secret',
    'secretkey',
    'secret_key',
    'client_secret',
    'clientsecret',
    'apikey',
    'api_key',
    'x_cg_pro_api_key',
    'x_cg_demo_api_key',
    'accesskey',
    'access_key',
    'privatekey',
    'private_key',
    'token',
    'accesstoken',
    'access_token',
    'refreshtoken',
    'refresh_token',
    'idtoken',
    'id_token',
    'authorization',
    'credential',
    'credentials',
    'smtppass',
    'smtp_pass',
    'smtpuser',
    'smtp_user',
    'webhookurl',
    'webhook_url',
]

/**
 * `key=value` / `key: value` assignments of a sensitive key. The value stops
 * at whitespace, a comma or a closing bracket so surrounding prose survives.
 *
 * Auth schemes (`Bearer`/`Basic`/…) are consumed as a whole so that the
 * scheme name is redacted together with its token, and an already redacted
 * value is matched literally to keep the helper idempotent.
 */
const SENSITIVE_ASSIGNMENT_REGEX = new RegExp(
    `\\b(${SENSITIVE_ASSIGNMENT_KEYS.join('|')})(\\s*[=:]\\s*)` +
    `("[^"]*"|'[^']*'|\\[REDACTED\\]|(?:Bearer|Basic|Digest|Token|Negotiate)\\s+\\S+|[^\\s,;)\\]}]+)`,
    'gi'
)

/** Stack frames appended to a message (`\n    at Object.<anonymous> (...)`). */
const STACK_FRAMES_REGEX = /\n\s+at\s+[^\n]*/g

/**
 * Replaces credential values in free-form text with `[REDACTED]`.
 *
 * Handles:
 *  - `password=hunter2`, `api_key: abc123`, `Authorization="Bearer x"` …
 *  - Stellar secret keys, CoinGecko keys, `?api_key=…`, `Bearer …` tokens,
 *    connection-string userinfo and `password …` assignments
 *    (via the shared `redactString` helper)
 */
export function sanitizeErrorMessage(message: string): string {
    if (typeof message !== 'string' || message.length === 0) return message

    let sanitized = message.replace(STACK_FRAMES_REGEX, '')

    sanitized = sanitized.replace(
        SENSITIVE_ASSIGNMENT_REGEX,
        (_match, key: string, separator: string) => `${key}${separator}${REDACTED_HINT}`
    )

    return redactString(sanitized)
}

/**
 * Recursively sanitizes an error `details` payload.
 *
 * Strings are passed through {@link sanitizeErrorMessage}. `Error` instances
 * are reduced to `{ name, message }` so no stack trace is serialized. Plain
 * objects and arrays are rebuilt with sanitized members, and fields whose
 * name denotes a secret (`apiKey`, `smtp_pass`, …) are masked entirely.
 */
export function sanitizeErrorDetails(details: unknown): unknown {
    if (details === null || details === undefined) return details

    if (details instanceof Error) {
        return { name: details.name, message: sanitizeErrorMessage(details.message) }
    }

    if (typeof details === 'string') return sanitizeErrorMessage(details)

    if (Array.isArray(details)) {
        return details.map(entry => sanitizeErrorDetails(entry))
    }

    if (typeof details === 'object') {
        const sanitized: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
            if (key === 'stack') continue
            sanitized[key] = isSensitiveKey(key) ? REDACTED_HINT : sanitizeErrorDetails(value)
        }
        return sanitized
    }

    return details
}
