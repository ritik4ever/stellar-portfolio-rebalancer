/**
 * Versioned REST namespace for portfolio, consent, notifications, prices, etc.
 *
 * The backend mounts the same Express router at:
 * - `/api/v1/*` — canonical (no Deprecation headers)
 * - `/api/*` — legacy compatibility (Deprecation / Sunset / Link per RFC 8594)
 *
 * JWT auth stays at `/api/auth/*` (not under this prefix). See `API_CONFIG.ENDPOINTS` in `api.ts`.
 *
 * Override for emergencies only:
 * - `VITE_USE_LEGACY_API=true` → use unversioned `/api/*` (deprecated surface).
 * - `VITE_API_VERSION=v1` (default) → `/api/v1/*`.
 */
export function getApiResourceRoot(): string {
    if (import.meta.env.VITE_USE_LEGACY_API === 'true') {
        return '/api'
    }
    const raw = String(import.meta.env.VITE_API_VERSION ?? 'v1').trim().replace(/^\/+|\/+$/g, '')
    return `/api/${raw || 'v1'}`
}
