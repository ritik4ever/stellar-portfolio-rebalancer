import { useState, useCallback } from 'react'

/** Every action that can be bound to a keyboard shortcut. */
export type ShortcutAction =
  | 'openShortcuts'
  | 'newPortfolio'
  | 'executeRebalance'
  | 'openSettings'
  | 'nextPortfolio'
  | 'prevPortfolio'

/** The factory-default key for each action. */
export const DEFAULT_KEYBINDINGS: Record<ShortcutAction, string> = {
  openShortcuts: '?',
  newPortfolio: 'n',
  executeRebalance: 'r',
  openSettings: ',',
  nextPortfolio: ']',
  prevPortfolio: '[',
}

/** Human-readable label for each shortcut action. */
export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  openShortcuts: 'Open keyboard shortcuts',
  newPortfolio: 'Create new portfolio',
  executeRebalance: 'Execute rebalance',
  openSettings: 'Open settings',
  nextPortfolio: 'Next portfolio',
  prevPortfolio: 'Previous portfolio',
}

/** All action names in a stable display order. */
export const ACTION_ORDER: ShortcutAction[] = [
  'openShortcuts',
  'newPortfolio',
  'executeRebalance',
  'openSettings',
  'nextPortfolio',
  'prevPortfolio',
]

const STORAGE_KEY = 'custom-keybindings'

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/** Read custom keybindings from localStorage, falling back to defaults. */
export function loadKeybindings(): Record<ShortcutAction, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_KEYBINDINGS }

    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_KEYBINDINGS }

    // Merge: use stored value only when key is a known action and value is a non-empty string
    const result = { ...DEFAULT_KEYBINDINGS }
    for (const action of ACTION_ORDER) {
      if (typeof parsed[action] === 'string' && parsed[action].length > 0) {
        result[action] = parsed[action]
      }
    }
    return result
  } catch {
    return { ...DEFAULT_KEYBINDINGS }
  }
}

/** Persist the full keybinding map. */
export function saveKeybindings(bindings: Record<ShortcutAction, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
  } catch {
    /* storage full / unavailable — silently degrade */
  }
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

export interface ConflictResult {
  /** The action that already owns the key, or `null` when there is no conflict. */
  conflictAction: ShortcutAction | null
}

/**
 * Check whether assigning `newKey` to `action` would collide with another
 * action in the current binding map.
 *
 * Comparison is case-insensitive so that 'n' and 'N' are treated as the same key.
 */
export function findConflict(
  bindings: Record<ShortcutAction, string>,
  action: ShortcutAction,
  newKey: string,
): ConflictResult {
  const normalised = newKey.toLowerCase()
  for (const [existingAction, existingKey] of Object.entries(bindings)) {
    if (existingAction === action) continue
    if (existingKey.toLowerCase() === normalised) {
      return { conflictAction: existingAction as ShortcutAction }
    }
  }
  return { conflictAction: null }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export type UpdateResult =
  | { ok: true }
  | { ok: false; conflict: ShortcutAction }

export function useKeybindings() {
  const [bindings, setBindings] = useState<Record<ShortcutAction, string>>(() => loadKeybindings())

  /** Attempt to remap `action` to `newKey`. Returns conflict info without saving when there's a clash. */
  const updateBinding = useCallback(
    (action: ShortcutAction, newKey: string): UpdateResult => {
      const { conflictAction } = findConflict(bindings, action, newKey)
      if (conflictAction) {
        return { ok: false, conflict: conflictAction }
      }
      const next = { ...bindings, [action]: newKey }
      setBindings(next)
      saveKeybindings(next)
      return { ok: true }
    },
    [bindings],
  )

  /** Reset every binding back to factory defaults. */
  const resetBindings = useCallback(() => {
    const defaults = { ...DEFAULT_KEYBINDINGS }
    setBindings(defaults)
    saveKeybindings(defaults)
  }, [])

  return { bindings, updateBinding, resetBindings } as const
}
