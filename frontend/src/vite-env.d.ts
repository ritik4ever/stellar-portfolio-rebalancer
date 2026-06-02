/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL: string
    /** API segment after `/api/`, e.g. `v1` → `/api/v1/...` */
    readonly VITE_API_VERSION?: string
    /** `true` → use deprecated unversioned `/api/*` instead of `/api/v1/*` */
    readonly VITE_USE_LEGACY_API?: string
    readonly VITE_WS_URL?: string
    readonly VITE_COINGECKO_API_KEY: string
    readonly VITE_ENABLE_QUERY_DEVTOOLS?: string
    readonly VITE_SENTRY_ENABLED?: string
    readonly VITE_SENTRY_DSN?: string
    readonly VITE_SENTRY_ENVIRONMENT?: string
    readonly VITE_SENTRY_RELEASE?: string
    readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string
    readonly VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE?: string
    readonly VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE?: string
    readonly MODE: string
    readonly BASE_URL: string
    readonly PROD: boolean
    readonly DEV: boolean
    readonly SSR: boolean
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
