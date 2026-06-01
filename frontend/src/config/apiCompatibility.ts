import { API_CONFIG } from './api'
import { getApiResourceRoot } from './apiVersion'

export type ApiCompatibilitySeverity = 'ok' | 'warning' | 'error'

export interface ApiCompatibilityResult {
    severity: ApiCompatibilitySeverity
    title: string
    message: string
    configuredOrigin: string
    configuredApiRoot: string
    probedUrl?: string
    httpStatus?: number
    details?: string
}

function isEnvelopeBody(body: unknown): boolean {
    if (!body || typeof body !== 'object') return false
    const record = body as Record<string, unknown>
    return typeof record.success === 'boolean' && ('data' in record || 'error' in record)
}

export async function checkApiCompatibility(
    signal?: AbortSignal,
): Promise<ApiCompatibilityResult> {
    const configuredOrigin = API_CONFIG.BASE_URL.replace(/\/$/, '')
    const configuredApiRoot = getApiResourceRoot()
    const probePath = `${configuredApiRoot}/strategies`
    const probedUrl = `${configuredOrigin}${probePath}`

    try {
        const response = await fetch(probedUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            mode: 'cors',
            credentials: 'omit',
            signal,
        })

        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.includes('application/json')) {
            return {
                severity: 'error',
                title: 'API target mismatch',
                message:
                    'The configured API origin did not return JSON. Check VITE_API_URL and that the backend is running.',
                configuredOrigin,
                configuredApiRoot,
                probedUrl,
                httpStatus: response.status,
                details: `Content-Type: ${contentType || 'unknown'}`,
            }
        }

        const body: unknown = await response.json()
        const usesLegacyRoot = configuredApiRoot === '/api'
        const hasDeprecation = response.headers.has('deprecation')

        if (!isEnvelopeBody(body)) {
            return {
                severity: 'error',
                title: 'Unexpected API response shape',
                message:
                    'The backend response is missing the standard success/data envelope. Your API version or origin may be wrong.',
                configuredOrigin,
                configuredApiRoot,
                probedUrl,
                httpStatus: response.status,
            }
        }

        if (!usesLegacyRoot && hasDeprecation) {
            return {
                severity: 'warning',
                title: 'API version mismatch',
                message:
                    'The app is configured for /api/v1 but the server responded with legacy deprecation headers.',
                configuredOrigin,
                configuredApiRoot,
                probedUrl,
                httpStatus: response.status,
            }
        }

        if (usesLegacyRoot && !hasDeprecation && response.ok) {
            return {
                severity: 'warning',
                title: 'Legacy API surface in use',
                message:
                    'VITE_USE_LEGACY_API is enabled. Consider switching to /api/v1 before the legacy routes are removed.',
                configuredOrigin,
                configuredApiRoot,
                probedUrl,
                httpStatus: response.status,
            }
        }

        if (!response.ok) {
            const envelope = body as { error?: { message?: string } }
            return {
                severity: 'warning',
                title: 'API probe returned an error',
                message:
                    envelope.error?.message ??
                    `The compatibility probe returned HTTP ${response.status}.`,
                configuredOrigin,
                configuredApiRoot,
                probedUrl,
                httpStatus: response.status,
            }
        }

        return {
            severity: 'ok',
            title: 'API configuration looks compatible',
            message: `Connected to ${configuredOrigin}${configuredApiRoot}.`,
            configuredOrigin,
            configuredApiRoot,
            probedUrl,
            httpStatus: response.status,
        }
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return {
                severity: 'ok',
                title: 'API compatibility check skipped',
                message: 'Startup probe was cancelled.',
                configuredOrigin,
                configuredApiRoot,
                probedUrl,
            }
        }

        return {
            severity: 'error',
            title: 'Cannot reach configured API',
            message:
                error instanceof Error
                    ? error.message
                    : 'Network error while probing the configured API origin.',
            configuredOrigin,
            configuredApiRoot,
            probedUrl,
        }
    }
}
