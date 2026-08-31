import React from 'react'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

const preferenceLabels = {
    system: 'system',
    light: 'light',
    dark: 'dark',
} as const

const ThemeToggle: React.FC = () => {
    const { isDark, preference, toggleTheme } = useTheme()

    const nextPreference =
        preference === 'system' ? 'light' : preference === 'light' ? 'dark' : 'system'

    return (
        <button
            onClick={toggleTheme}
            aria-label={`Theme: ${preferenceLabels[preference]}. Switch to ${preferenceLabels[nextPreference]} mode.`}
            className="p-2 rounded-lg transition-colors text-gray-600 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-200 dark:hover:bg-gray-700"
        >
            {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>
    )
}

export default ThemeToggle
