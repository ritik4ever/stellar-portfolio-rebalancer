import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

export interface ToastItem {
  id: string
  title?: string
  description?: string
  tone: 'info' | 'success' | 'warning' | 'error'
}

interface ToastContextType {
  toasts: ToastItem[]
  showToast: (toast: Omit<ToastItem, 'id'>) => void
  dismissToast: (id: string) => void
}

const ToastContext = createContext<ToastContextType>({
  toasts: [],
  showToast: () => {},
  dismissToast: () => {},
})

let nextId = 0
function generateId(): string {
  nextId += 1
  return `toast-${nextId}`
}

export const ToastProvider: React.FC<{
  children: React.ReactNode
  maxVisible?: number
  duration?: number
}> = ({ children, maxVisible = 5, duration = 3000 }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const queueRef = useRef<Omit<ToastItem, 'id'>[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((prev) => {
      const next = prev.filter((t) => t.id !== id)
      const queued = queueRef.current.shift()
      if (queued && next.length < maxVisible) {
        const newToast = { ...queued, id: generateId() }
        timersRef.current.set(
          newToast.id,
          setTimeout(() => dismissToast(newToast.id), duration),
        )
        return [...next, newToast]
      }
      return next
    })
  }, [maxVisible, duration])

  const showToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      setToasts((prev) => {
        if (prev.length < maxVisible) {
          const newToast = { ...toast, id: generateId() }
          timersRef.current.set(
            newToast.id,
            setTimeout(() => dismissToast(newToast.id), duration),
          )
          return [...prev, newToast]
        }
        queueRef.current.push(toast)
        return prev
      })
    },
    [maxVisible, duration, dismissToast],
  )

  const value = useMemo(() => ({ toasts, showToast, dismissToast }), [toasts, showToast, dismissToast])

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export const useToast = () => useContext(ToastContext)
