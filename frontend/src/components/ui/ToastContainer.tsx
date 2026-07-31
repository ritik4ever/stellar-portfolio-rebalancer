import React from 'react'
import { Toast } from './Toast'
import { useToast } from '../../context/ToastContext'

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useToast()

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
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
            onDismiss={() => dismissToast(toast.id)}
          />
        </div>
      ))}
    </div>
  )
}
