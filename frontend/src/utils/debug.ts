type ImportMetaEnvLike = {
    DEV?: boolean
    PROD?: boolean
    MODE?: string
    VITE_ENABLE_API_DEBUG_LOGS?: string
    VITE_ENABLE_API_PROD_LOGS?: string
}

const REDACTED = '[REDACTED]'

const SENSITIVE_KEY_PATTERN = /(authorization|token|secret|password|cookie|session|key|credential|jwt)/i

function isSensitiveKey(key: string): boolean {
    return SENSITIVE_KEY_PATTERN.test(key)
}

function summarizeValue(value: unknown): unknown {
    if (value == null) return value
    if (Array.isArray(value)) {
        return {
            type: 'array',
            length: value.length,
        }
    }
    if (typeof value === 'object') {
        return {
            type: 'object',
            keys: Object.keys(value as Record<string, unknown>),
        }
    }
    if (typeof value === 'string') {
        return {
            type: 'string',
            length: value.length,
        }
    }
    return value
}

export function getFrontendDebugConfig(env: ImportMetaEnvLike = (import.meta as any).env ?? {}) {
    const isDevelopment = env.DEV === true || env.MODE === 'development'
    const forceApiDebugLogs = env.VITE_ENABLE_API_DEBUG_LOGS === 'true'
    const enableProductionApiLogs = env.VITE_ENABLE_API_PROD_LOGS === 'true'

    return {
        isDevelopment,
        enableApiDebugLogs: isDevelopment || forceApiDebugLogs,
        enableProductionApiLogs,
    }
}

export function sanitizeHeadersForLog(
    headers?: HeadersInit | Record<string, unknown> | null,
): Record<string, string> {
    if (!headers) return {}

    const rawEntries = headers instanceof Headers
        ? Array.from(headers.entries())
        : Array.isArray(headers)
            ? headers.map(([key, value]) => [key, String(value)] as const)
            : Object.entries(headers).map(([key, value]) => [key, String(value)] as const)

    return Object.fromEntries(
        rawEntries.map(([key, value]) => [key, isSensitiveKey(key) ? REDACTED : value]),
    )
}

export function summarizePayloadForLog(payload: unknown): unknown {
    if (payload == null) return undefined

    if (typeof payload === 'string') {
        try {
            return summarizePayloadForLog(JSON.parse(payload))
        } catch {
            return {
                type: 'string',
                length: payload.length,
            }
        }
    }

    if (Array.isArray(payload)) {
        return {
            type: 'array',
            length: payload.length,
        }
    }

    if (typeof payload === 'object') {
        return Object.fromEntries(
            Object.entries(payload as Record<string, unknown>).map(([key, value]) => [
                key,
                isSensitiveKey(key) ? REDACTED : summarizeValue(value),
            ]),
        )
    }

    return summarizeValue(payload)
}

export function summarizeResponseForLog(payload: unknown): unknown {
    if (payload == null) return payload

    if (typeof payload === 'object' && !Array.isArray(payload)) {
        const record = payload as Record<string, unknown>
        return {
            keys: Object.keys(record),
            success: typeof record.success === 'boolean' ? record.success : undefined,
            errorCode:
                record.error && typeof record.error === 'object'
                    ? (record.error as Record<string, unknown>).code
                    : undefined,
        }
    }

    return summarizeValue(payload)
}

export function debugLog(message: string, details?: unknown): void {
    if (!getFrontendDebugConfig().enableApiDebugLogs) return
    if (details === undefined) {
        console.debug(message)
        return
    }
    console.debug(message, details)
}

export function logApiRequest(
    message: string,
    details?: {
        headers?: HeadersInit | Record<string, unknown> | null
        body?: unknown
    },
    env: ImportMetaEnvLike = (import.meta as any).env ?? {},
): void {
    const config = getFrontendDebugConfig(env)
    if (!config.enableApiDebugLogs) return

    console.debug(message, {
        headers: sanitizeHeadersForLog(details?.headers),
        body: summarizePayloadForLog(details?.body),
    })
}

export function logApiResponse(
    message: string,
    details?: {
        status?: number
        headers?: HeadersInit | Record<string, unknown> | null
        body?: unknown
    },
    env: ImportMetaEnvLike = (import.meta as any).env ?? {},
): void {
    const config = getFrontendDebugConfig(env)
    if (config.enableApiDebugLogs) {
        console.debug(message, {
            status: details?.status,
            headers: sanitizeHeadersForLog(details?.headers),
            body: summarizeResponseForLog(details?.body),
        })
        return
    }

    if (!config.enableProductionApiLogs) return

    console.info(message, {
        status: details?.status,
        body: summarizeResponseForLog(details?.body),
    })
}
