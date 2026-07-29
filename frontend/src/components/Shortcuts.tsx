import { useState, useEffect, useCallback } from 'react'
import { Keyboard, X, Settings } from 'lucide-react'
import KeybindingSettings from './KeybindingSettings'
import {
  ACTION_ORDER,
  SHORTCUT_LABELS,
  useKeybindings,
  type ShortcutAction,
} from '../hooks/useKeybindings'

interface ShortcutsProps {
  onNewPortfolio?: () => void
  onExecuteRebalance?: () => void
  onOpenSettings?: () => void
  onNavigatePortfolios?: (direction: 'next' | 'prev') => void
}

/** Maps a ShortcutAction to the callback it should invoke. */
function buildActionMap(props: ShortcutsProps): Partial<Record<ShortcutAction, () => void>> {
  return {
    newPortfolio: props.onNewPortfolio ? () => props.onNewPortfolio!() : undefined,
    executeRebalance: props.onExecuteRebalance ? () => props.onExecuteRebalance!() : undefined,
    openSettings: props.onOpenSettings ? () => props.onOpenSettings!() : undefined,
    nextPortfolio: props.onNavigatePortfolios ? () => props.onNavigatePortfolios!('next') : undefined,
    prevPortfolio: props.onNavigatePortfolios ? () => props.onNavigatePortfolios!('prev') : undefined,
  }
}

function Shortcuts({ onNewPortfolio, onExecuteRebalance, onOpenSettings, onNavigatePortfolios }: ShortcutsProps) {
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { bindings } = useKeybindings()

  // Force a re-render when bindings change in the settings modal
  const [, forceUpdate] = useState(0)
  const handleBindingsChanged = useCallback(() => forceUpdate((c) => c + 1), [])

  const actionMap = buildActionMap({ onNewPortfolio, onExecuteRebalance, onOpenSettings, onNavigatePortfolios })

  const isInputFocused = useCallback(() => {
    const tag = document.activeElement?.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.getAttribute('contenteditable') === 'true'
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't process shortcuts while remapping
      if (settingsOpen) return

      if (isInputFocused()) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      // Check for the "open shortcuts" key first (it toggles the panel)
      if (e.key.toLowerCase() === bindings.openShortcuts.toLowerCase()) {
        e.preventDefault()
        setOpen((prev) => !prev)
        return
      }

      // When the panel is open, don't fire other shortcuts
      if (open) return

      // Data-driven dispatch: find the action whose bound key matches
      for (const action of ACTION_ORDER) {
        if (action === 'openShortcuts') continue
        if (e.key.toLowerCase() === bindings[action].toLowerCase()) {
          const handler = actionMap[action]
          if (handler) {
            e.preventDefault()
            handler()
          }
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, settingsOpen, isInputFocused, bindings, actionMap])

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
                {ACTION_ORDER.map((action) => (
                  <li
                    key={action}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {SHORTCUT_LABELS[action]}
                    </span>
                    <kbd className="ml-4 inline-flex min-w-[1.75rem] items-center justify-center rounded-md border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs font-mono font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {bindings[action]}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Press{' '}
                <kbd className="inline-flex items-center rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs font-mono dark:border-gray-600 dark:bg-gray-800">
                  Esc
                </kbd>{' '}
                to close.
              </p>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950"
              >
                <Settings className="h-3.5 w-3.5" />
                Customize
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <KeybindingSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onBindingsChanged={handleBindingsChanged}
      />
    </>
  )
}

export default Shortcuts
