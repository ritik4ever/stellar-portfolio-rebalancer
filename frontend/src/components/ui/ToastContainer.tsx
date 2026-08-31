import React from 'react'
import { ToastStack } from './Toast'
import { useToast } from '../../context/ToastContext'

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useToast()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
