import React, { useEffect } from 'react'

export interface ModalProps {
  open: boolean
  title?: string
  description?: string
  onClose: () => void
  children?: React.ReactNode
  footer?: React.ReactNode
}

export const Modal: React.FC<ModalProps> = ({ open, title, description, onClose, children, footer }) => {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 dark:bg-black/70" aria-hidden onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-6 shadow-xl">
        {title && <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>}
        {description && <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{description}</p>}
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  )
}

</parameter>
</write_to_file>