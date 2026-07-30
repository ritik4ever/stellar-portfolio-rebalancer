import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { ThemeProvider, useTheme, bootstrapThemeBeforeHydration } from './ThemeContext'

function ThemeProbe() {
    const { isDark, preference, toggleTheme } = useTheme()
    return (
        <div>
            <span data-testid="preference">{preference}</span>
            <span data-testid="is-dark">{String(isDark)}</span>
            <button type="button" onClick={toggleTheme}>
                cycle
            </button>
        </div>
    )
}

describe('ThemeContext', () => {
    let matchMediaListeners: Array<() => void>
    let prefersDark: boolean

    beforeEach(() => {
        localStorage.clear()
        document.documentElement.classList.remove('dark')
        matchMediaListeners = []
        prefersDark = false
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            configurable: true,
            value: (query: string) => ({
                get matches() {
                    return query.includes('dark') && prefersDark
                },
                media: query,
                onchange: null,
                addEventListener: (_: string, handler: () => void) => {
                    matchMediaListeners.push(handler)
                },
                removeEventListener: (_: string, handler: () => void) => {
                    matchMediaListeners = matchMediaListeners.filter((item) => item !== handler)
                },
                addListener: (handler: () => void) => {
                    matchMediaListeners.push(handler)
                },
                removeListener: (handler: () => void) => {
                    matchMediaListeners = matchMediaListeners.filter((item) => item !== handler)
                },
                dispatchEvent: () => true,
            }),
        })
    })

    afterEach(() => {
        cleanup()
        delete (window as Window & { matchMedia?: unknown }).matchMedia
    })

    it('bootstraps dark class from stored preference', () => {
        localStorage.setItem('theme-preference', 'dark')
        bootstrapThemeBeforeHydration()
        expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('syncs preference from storage events in another tab', () => {
        render(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>,
        )
        expect(screen.getByTestId('preference')).toHaveTextContent('system')

        act(() => {
            window.dispatchEvent(
                new StorageEvent('storage', {
                    key: 'theme-preference',
                    newValue: 'dark',
                }),
            )
        })

        expect(screen.getByTestId('preference')).toHaveTextContent('dark')
        expect(screen.getByTestId('is-dark')).toHaveTextContent('true')
    })

    it('follows system color scheme when preference is system', () => {
        localStorage.setItem('theme-preference', 'system')
        render(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>,
        )
        expect(screen.getByTestId('is-dark')).toHaveTextContent('false')

        act(() => {
            prefersDark = true
            matchMediaListeners.forEach((handler) => handler())
        })
        expect(screen.getByTestId('is-dark')).toHaveTextContent('true')
    })

    it('cycles theme preference on toggle', () => {
        render(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>,
        )
        fireEvent.click(screen.getByRole('button', { name: 'cycle' }))
        expect(screen.getByTestId('preference')).toHaveTextContent('light')
        fireEvent.click(screen.getByRole('button', { name: 'cycle' }))
        expect(screen.getByTestId('preference')).toHaveTextContent('dark')
    })

    it('cleans up media query listener on unmount', () => {
        const before = matchMediaListeners.length
        const { unmount } = render(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>,
        )
        // After mount there should be at least one listener for the system theme
        expect(matchMediaListeners.length).toBeGreaterThan(before)

        unmount()
        // After unmount all listeners should have been removed
        expect(matchMediaListeners.length).toBe(before)
    })

    it('stops responding to system theme changes after unmount', () => {
        const { unmount } = render(
            <ThemeProvider>
                <ThemeProbe />
            </ThemeProvider>,
        )
        unmount()

        const prevListeners = matchMediaListeners.length
        act(() => {
            prefersDark = true
            matchMediaListeners.forEach((handler) => handler())
        })

        expect(matchMediaListeners.length).toBe(prevListeners)
    })
})
