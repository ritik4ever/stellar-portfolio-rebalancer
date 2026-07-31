import React from 'react'

export interface ToastProps {
  title?: string
  description?: string
  tone?: 'info' | 'success' | 'warning' | 'error'
  onDismiss?: () => void
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
