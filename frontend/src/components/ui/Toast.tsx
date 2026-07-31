import React from 'react'

export interface ToastProps {
  title?: string
  description?: string
  tone?: 'info' | 'success' | 'warning' | 'error'
}

const toneClasses: Record<NonNullable<ToastProps['tone']>, string> = {
  info: 'border-sky-700 bg-sky-700/20',
  success: 'border-emerald-700 bg-emerald-700/20',
  warning: 'border-amber-700 bg-amber-700/20',
  error: 'border-red-700 bg-red-700/20',
}

export const Toast: React.FC<ToastProps> = ({ title, description, tone = 'info' }) => {
  return (
    <div role="status" className={`w-80 rounded-lg border-l-4 p-4 text-white shadow-lg ${toneClasses[tone]}`}>
      {title && <p className="text-sm font-semibold">{title}</p>}
      {description && <p className="mt-1 text-xs text-gray-100">{description}</p>}
    </div>
  )
}
