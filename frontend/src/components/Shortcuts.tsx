import { useState, useEffect, useCallback } from 'react'
import { Keyboard, X } from 'lucide-react'

interface Shortcut {
  key: string
  description: string
  action: () => void
}

interface ShortcutsProps {
  onNewPortfolio?: () => void
  onExecuteRebalance?: () => void
  onOpenSettings?: () => void
  onNavigatePortfolios?: (direction: 'next' | 'prev') => void
}

const STORAGE_KEY = 'shortcuts-dismissed'

const shortcuts: { key: string; label: string; description: string }[] = [
  { key: '?', label: '?', description: 'Open keyboard shortcuts' },
  { key: 'n', label: 'N', description: 'Create new portfolio' },
  { key: 'r', label: 'R', description: 'Execute rebalance' },
  { key: ',', label: ',', description: 'Open settings' },
  { key: ']', label: ']', description: 'Next portfolio' },
  { key: '[', label: '[', description: 'Previous portfolio' },
]

function Shortcuts({ onNewPortfolio, onExecuteRebalance, onOpenSettings, onNavigatePortfolios }: ShortcutsProps) {
  const [open, setOpen] = useState(false)

  const isInputFocused = useCallback(() => {
    const tag = document.activeElement?.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.getAttribute('contenteditable') === 'true'
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isInputFocused()) return
        e.preventDefault()
        setOpen((prev) => !prev)
        return
      }

      if (open) return

      if (isInputFocused()) return

      if (e.ctrlKey || e.metaKey || e.altKey) return

      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault()
          onNewPortfolio?.()
          break
        case 'r':
        case 'R':
          e.preventDefault()
          onExecuteRebalance?.()
          break
        case ',':
          e.preventDefault()
          onOpenSettings?.()
          break
        case ']':
          e.preventDefault()
          onNavigatePortfolios?.('next')
          break
        case '[':
          e.preventDefault()
          onNavigatePortfolios?.('prev')
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, isInputFocused, onNewPortfolio, onExecuteRebalance, onOpenSettings, onNavigatePortfolios])

  useEffect(() => {
    if (!open) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-20 right-4 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white text-xs font-mono font-bold text-gray-600 shadow-md hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
      >
        <Keyboard className="h-4 w-4" />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Keyboard shortcuts"
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <Keyboard className="h-5 w-5 text-gray-500" />
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  Keyboard Shortcuts
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close shortcuts"
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4">
              <ul className="space-y-2">
                {shortcuts.map((shortcut) => (
                  <li
                    key={shortcut.key}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {shortcut.description}
                    </span>
                    <kbd className="ml-4 inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs font-mono font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {shortcut.label}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-gray-200 px-5 py-3 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Shortcuts are disabled when typing in text fields. Press{' '}
                <kbd className="inline-flex items-center rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs font-mono dark:border-gray-600 dark:bg-gray-800">
                  Esc
                </kbd>{' '}
                to close this panel.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default Shortcuts
