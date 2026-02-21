/**
 * Centralized utility for redacting sensitive secrets from strings, URLs, and objects.
 * Designed to prevent debug endpoint exposure and logging leaks of API keys or private keys.
 */

// Regular expressions for identifying sensitive data
const STELLAR_SECRET_REGEX = /S[A-Z2-7]{55}/g;
// Matches CoinGecko Pro API keys (typically cg-...) or simple UUIDs if they are in query params
const CG_API_KEY_REGEX = /c?g-[a-zA-Z0-9_-]{10,}/g;
// Matches general query parameter API keys: ?api_key=SECRET or &apikey=SECRET or ?x_cg_pro_api_key=SECRET
const QUERY_PARAM_KEY_REGEX = /([?&](?:api_key|apikey|x_cg_pro_api_key|x_cg_demo_api_key)=)[^&]+/gi;

const REDACTED_HINT = '[REDACTED]';

/**
 * Redacts sensitive tokens from a given string.
 */
export function redactString(str: string): string {
    if (typeof str !== 'string') return str;

    let redacted = str
        // Redact Stellar Secrets
        .replace(STELLAR_SECRET_REGEX, REDACTED_HINT)
        // Redact explicit CoinGecko Keys if identifiable
        .replace(CG_API_KEY_REGEX, REDACTED_HINT)
        // Redact keys in URLs
        .replace(QUERY_PARAM_KEY_REGEX, `$1${REDACTED_HINT}`);

    return redacted;
}

/**
 * Deeply traverses an object or array and redacts sensitive string values.
 * Safe for JSON serialization.
 */
export function redactObject<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
        return redactString(obj) as unknown as T;
    }

    if (Array.isArray(obj)) {
        return obj.map(item => redactObject(item)) as unknown as T;
    }

    if (typeof obj === 'object') {
        const redactedObj: any = {};
        for (const [key, value] of Object.entries(obj)) {
            // Mask keys themselves that might accidentally be a secret (rare)
            const safeKey = redactString(key);

            // Mask header objects explicitly if they contain API keys
            if (safeKey.toLowerCase() === 'x-cg-pro-api-key' || safeKey.toLowerCase() === 'x-cg-demo-api-key' || safeKey.toLowerCase() === 'authorization') {
                redactedObj[safeKey] = REDACTED_HINT;
            } else {
                redactedObj[safeKey] = redactObject(value);
            }
        }
        return redactedObj as T;
    }

    return obj;
}

/**
 * Helper to wrap console.log arguments.
 * Usage: console.log(...redactArgs(args))
 */
export function redactArgs(args: any[]): any[] {
    return args.map(arg => redactObject(arg));
}
