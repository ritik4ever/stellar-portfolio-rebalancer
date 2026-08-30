import React, { useEffect, useRef, useId } from 'react'

export interface ModalProps {
  open: boolean
  title?: string
  description?: string
  onClose: () => void
  children?: React.ReactNode
  footer?: React.ReactNode
}

export const Modal: React.FC<ModalProps> = ({ open, title, description, onClose, children, footer }) => {
  const modalRef = useRef<HTMLDivElement>(null)
  const previousActiveElementRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const descriptionId = useId()

  // Keep the onClose ref up to date
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    // Store the previously focused element
    previousActiveElementRef.current = document.activeElement as HTMLElement

    const modal = modalRef.current
    if (!modal) return

    // Focus the modal itself
    modal.focus()

    const getFocusableElements = (): HTMLElement[] => {
      const focusableSelectors = [
        'button:not([disabled])',
        '[href]',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
      ]
      return Array.from(modal.querySelectorAll<HTMLElement>(focusableSelectors.join(',')))
    }

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const focusableElements = getFocusableElements()
      if (focusableElements.length === 0) return

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (e.shiftKey) {
        // Shift+Tab: if focus is on first element, move to last
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        // Tab: if focus is on last element, move to first
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
      handleTabKey(e)
    }

    document.addEventListener('keydown', onKey)

    // Cleanup: restore focus to previous element
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus()
      }
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 dark:bg-black/70" aria-hidden onClick={onClose} />
      <div
        ref={modalRef}
        className="relative w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        {title && <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>}
        {description && <p id={descriptionId} className="mt-1 text-sm text-gray-600 dark:text-gray-400">{description}</p>}
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  )
}
