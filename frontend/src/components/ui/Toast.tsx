import React from 'react'

export const DEFAULT_TOAST_MAX_VISIBLE = 5
export const DEFAULT_TOAST_DURATION_MS = 3000

export interface ToastProps {
  title?: string
  description?: string
  tone?: 'info' | 'success' | 'warning' | 'error'
  onDismiss?: () => void
}

export interface ToastStackItem extends ToastProps {
  id: string
}

const toneClasses: Record<NonNullable<ToastProps['tone']>, string> = {
  info: 'border-sky-700 bg-sky-700/20',
  success: 'border-emerald-700 bg-emerald-700/20',
  warning: 'border-amber-700 bg-amber-700/20',
  error: 'border-red-700 bg-red-700/20',
}

export const Toast: React.FC<ToastProps> = ({ title, description, tone = 'info', onDismiss }) => {
  return (
    <div
      role="status"
      className={`flex w-80 items-start gap-3 rounded-lg border-l-4 p-4 text-white shadow-lg transition-all duration-300 ${toneClasses[tone]}`}
    >
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-semibold">{title}</p>}
        {description && <p className="mt-1 text-xs text-gray-100">{description}</p>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 text-white/60 hover:text-white/90 transition-colors"
          aria-label="Dismiss"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
          </svg>
        </button>
      )}
    </div>
  )
}

/**
 * Vertical stack of toasts. Used by ToastContainer so simultaneous toasts
 * remain visible instead of overwriting one another.
 */
export const ToastStack: React.FC<{
  toasts: ToastStackItem[]
  onDismiss?: (id: string) => void
}> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null

  return (
    <div
      className="flex flex-col gap-2"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="animate-in slide-in-from-right-2 fade-in duration-300"
        >
          <Toast
            title={toast.title}
            description={toast.description}
            tone={toast.tone}
            onDismiss={onDismiss ? () => onDismiss(toast.id) : toast.onDismiss}
          />
        </div>
      ))}
    </div>
  )
}
