import { useState, useEffect, useCallback } from 'react'
import { RotateCcw, AlertTriangle } from 'lucide-react'
import { Modal } from './ui/Modal'
import {
  ACTION_ORDER,
  SHORTCUT_LABELS,
  useKeybindings,
  type ShortcutAction,
} from '../hooks/useKeybindings'

interface KeybindingSettingsProps {
  open: boolean
  onClose: () => void
  /** Notify parent that bindings changed so the shortcut list can re-render. */
  onBindingsChanged?: () => void
}

export default function KeybindingSettings({ open, onClose, onBindingsChanged }: KeybindingSettingsProps) {
  const { bindings, updateBinding, resetBindings } = useKeybindings()

  /** Which action (if any) is currently listening for a new keypress. */
  const [listeningAction, setListeningAction] = useState<ShortcutAction | null>(null)

  /** Transient conflict message. `{ action, message }` */
  const [conflict, setConflict] = useState<{ action: ShortcutAction; message: string } | null>(null)

  // Clear conflict when the user starts a new listen
  useEffect(() => {
    if (listeningAction) setConflict(null)
  }, [listeningAction])

  // Capture the next keypress when in listening mode
  useEffect(() => {
    if (!listeningAction) return

    const handler = (e: KeyboardEvent) => {
      // Ignore modifier-only presses
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return

      e.preventDefault()
      e.stopPropagation()

      const result = updateBinding(listeningAction, e.key)
      if (!result.ok) {
        setConflict({
          action: listeningAction,
          message: `Already assigned to "${SHORTCUT_LABELS[result.conflict]}"`,
        })
      } else {
        onBindingsChanged?.()
      }
      setListeningAction(null)
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [listeningAction, updateBinding, onBindingsChanged])

  const handleReset = useCallback(() => {
    resetBindings()
    setConflict(null)
    setListeningAction(null)
    onBindingsChanged?.()
  }, [resetBindings, onBindingsChanged])

  // Cancel listening when modal closes
  useEffect(() => {
    if (!open) {
      setListeningAction(null)
      setConflict(null)
    }
  }, [open])

  return (
    <Modal
      open={open}
      title="Customize Shortcuts"
      description="Click a key to remap it, then press the new key."
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Done
          </button>
        </>
      }
    >
      <ul className="space-y-1" role="list">
        {ACTION_ORDER.map((action) => {
          const isListening = listeningAction === action
          const hasConflict = conflict?.action === action

          return (
            <li key={action} className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {SHORTCUT_LABELS[action]}
              </span>

              <div className="flex items-center gap-2">
                {hasConflict && (
                  <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400" role="alert">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {conflict.message}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => setListeningAction(isListening ? null : action)}
                  className={`
                    inline-flex min-w-[2rem] items-center justify-center rounded-md border px-2 py-0.5
                    text-xs font-mono font-medium transition-all
                    ${
                      isListening
                        ? 'animate-pulse border-indigo-500 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-300 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-700'
                        : 'border-gray-300 bg-gray-50 text-gray-700 hover:border-indigo-400 hover:bg-indigo-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-500 dark:hover:bg-indigo-950'
                    }
                  `}
                  aria-label={isListening ? `Press a key for ${SHORTCUT_LABELS[action]}` : `Change key for ${SHORTCUT_LABELS[action]}`}
                >
                  {isListening ? '…' : bindings[action]}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
