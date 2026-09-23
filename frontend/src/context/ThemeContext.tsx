import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme-preference'
const LEGACY_STORAGE_KEY = 'theme'

interface ThemeContextType {
    isDark: boolean
    preference: ThemePreference
    toggleTheme: () => void
}

function readStoredPreference(): ThemePreference {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
            return stored
        }
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
        if (legacy === 'light' || legacy === 'dark') {
            return legacy
        }
    } catch {
        /* ignore */
    }
    return 'system'
}

function getColorSchemeMedia(): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return null
    }
    try {
        return window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
        return null
    }
}

function resolveIsDarkFromMedia(preference: ThemePreference, media: MediaQueryList | null): boolean {
    if (preference === 'dark') return true
    if (preference === 'light') return false
    return media?.matches ?? false
}

function resolveIsDark(preference: ThemePreference): boolean {
    return resolveIsDarkFromMedia(preference, getColorSchemeMedia())
}

export function applyThemeClass(isDark: boolean): void {
    const root = document.documentElement
    if (isDark) {
        root.classList.add('dark')
    } else {
        root.classList.remove('dark')
    }
}

export function bootstrapThemeBeforeHydration(): void {
    applyThemeClass(resolveIsDark(readStoredPreference()))
}

const ThemeContext = createContext<ThemeContextType>({
    isDark: false,
    preference: 'system',
    toggleTheme: () => {},
})

const PREFERENCE_CYCLE: ThemePreference[] = ['system', 'light', 'dark']

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [preference, setPreference] = useState<ThemePreference>(() => readStoredPreference())
    const [isDark, setIsDark] = useState(() => resolveIsDark(readStoredPreference()))

    // Keep a stable ref to the media query so the listener and the
    // immediate read always use the same MediaQueryList instance.
    const mediaRef = useRef<MediaQueryList | null>(null)

    const syncResolvedTheme = useCallback((nextPreference: ThemePreference) => {
        setIsDark(resolveIsDarkFromMedia(nextPreference, mediaRef.current))
    }, [])

    useEffect(() => {
        applyThemeClass(isDark)
        try {
            localStorage.setItem(STORAGE_KEY, preference)
            localStorage.removeItem(LEGACY_STORAGE_KEY)
        } catch {
            /* ignore */
        }
    }, [isDark, preference])

    useEffect(() => {
        syncResolvedTheme(preference)
    }, [preference, syncResolvedTheme])

    useEffect(() => {
        // Always update the media ref so resolveIsDarkFromMedia is never stale.
        mediaRef.current = getColorSchemeMedia()

        if (preference !== 'system') return undefined

        const media = mediaRef.current
        if (!media) return undefined

        // Immediately sync in case OS theme changed while preference was non-system.
        setIsDark(media.matches)

        const onChange = () => setIsDark(media.matches)

        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', onChange)
            return () => media.removeEventListener('change', onChange)
        }

        // Legacy Safari fallback
        media.addListener(onChange)
        return () => media.removeListener(onChange)
    }, [preference])

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key !== STORAGE_KEY || event.newValue == null) return
            if (event.newValue !== 'light' && event.newValue !== 'dark' && event.newValue !== 'system') {
                return
            }
            const next = event.newValue as ThemePreference
            setPreference(next)
            syncResolvedTheme(next)
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [syncResolvedTheme])

    const toggleTheme = useCallback(() => {
        setPreference((current) => {
            const index = PREFERENCE_CYCLE.indexOf(current)
            const next = PREFERENCE_CYCLE[(index + 1) % PREFERENCE_CYCLE.length]
            syncResolvedTheme(next)
            return next
        })
    }, [syncResolvedTheme])

    const value = useMemo(
        () => ({ isDark, preference, toggleTheme }),
        [isDark, preference, toggleTheme],
    )

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
