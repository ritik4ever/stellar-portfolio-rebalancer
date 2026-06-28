import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ThemeToggle from './ThemeToggle'

const themeMocks = vi.hoisted(() => ({
    toggleTheme: vi.fn(),
    isDark: false,
    preference: 'light' as 'light' | 'dark' | 'system',
}))

vi.mock('../context/ThemeContext', () => ({
    useTheme: vi.fn(() => ({
        isDark: themeMocks.isDark,
        preference: themeMocks.preference,
        toggleTheme: themeMocks.toggleTheme,
    })),
}))

describe('ThemeToggle', () => {
    beforeEach(() => {
        cleanup()
        vi.clearAllMocks()
        themeMocks.isDark = false
        themeMocks.preference = 'light'
    })

    it('exposes an accessible label and toggles the theme on click', () => {
        render(<ThemeToggle />)

        const button = screen.getByRole('button', { name: /switch to dark mode/i })
        fireEvent.click(button)

        expect(themeMocks.toggleTheme).toHaveBeenCalledTimes(1)
    })

    it('updates the accessible label for dark mode', () => {
        themeMocks.isDark = true
        themeMocks.preference = 'system'
        render(<ThemeToggle />)

        expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeTruthy()
    })

    it('keeps AA-compliant contrast tokens in both themes (no low-emphasis gray-500/400)', () => {
        render(<ThemeToggle />)

        const button = screen.getByRole('button')
        // Idle text must be at least gray-600 (light) / gray-300 (dark) to clear WCAG AA.
        expect(button.className).toContain('text-gray-600')
        expect(button.className).toContain('dark:text-gray-300')
        // Regression guard: the old low-contrast tokens must not return.
        expect(button.className).not.toMatch(/(^|\s)text-gray-500(\s|$)/)
        expect(button.className).not.toContain('dark:text-gray-400')
    })
})
