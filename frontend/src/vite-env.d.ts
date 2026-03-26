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
    readonly MODE: string
    readonly BASE_URL: string
    readonly PROD: boolean
    readonly DEV: boolean
    readonly SSR: boolean
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
