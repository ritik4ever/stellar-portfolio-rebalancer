import { useState, useEffect, useCallback, useMemo } from 'react'
import { X, CheckCircle2, Circle, ArrowRight, HelpCircle, ChevronDown } from 'lucide-react'
import { useUserPortfolios } from '../hooks/queries/usePortfolioQuery'
import { useRebalanceHistory } from '../hooks/queries/useHistoryQuery'

const DISMISSED_KEY = 'onboarding-checklist-dismissed'
const CHECKLIST_VERSION = '1'

interface ChecklistStep {
  id: string
  label: string
  href: string
}

const STEPS: ChecklistStep[] = [
  { id: 'connect-wallet', label: 'Connect Wallet', href: 'landing' },
  { id: 'create-portfolio', label: 'Create Portfolio', href: 'setup' },
  { id: 'set-allocations', label: 'Set Allocations', href: 'setup' },
  { id: 'execute-rebalance', label: 'Execute First Rebalance', href: 'dashboard' },
  { id: 'enable-auto-rebalance', label: 'Enable Auto-Rebalance', href: 'settings' },
]

interface OnboardingChecklistProps {
  publicKey: string | null
  onNavigate: (view: string) => void
}

function OnboardingChecklist({ publicKey, onNavigate }: OnboardingChecklistProps) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === CHECKLIST_VERSION
    } catch {
      return false
    }
  })
  const [open, setOpen] = useState(false)
  const [hasAutoShown, setHasAutoShown] = useState(false)

  const { data: portfolios } = useUserPortfolios(publicKey)

  const latestPortfolioId = useMemo(() => {
    if (!portfolios || portfolios.length === 0) return null
    const list = Array.isArray(portfolios) ? portfolios : (portfolios as any).data ?? []
    return list.length > 0 ? list[list.length - 1].id : null
  }, [portfolios])

  const { data: historyData } = useRebalanceHistory(latestPortfolioId, 1, 1)

  const hasPortfolio = useMemo(() => {
    if (!portfolios) return false
    const list = Array.isArray(portfolios) ? portfolios : (portfolios as any).data ?? []
    return list.length > 0
  }, [portfolios])

  const hasAllocations = useMemo(() => {
    if (!portfolios) return false
    const list = Array.isArray(portfolios) ? portfolios : (portfolios as any).data ?? []
    if (list.length === 0) return false
    const latest = list[list.length - 1]
    return latest?.allocations && latest.allocations.length > 0
  }, [portfolios])

  const hasRebalanced = useMemo(() => {
    if (!historyData) return false
    const records = Array.isArray(historyData)
      ? historyData
      : (historyData as any).data ?? (historyData as any).records ?? []
    return records.length > 0
  }, [historyData])

  const hasAutoRebalance = useMemo(() => {
    if (!portfolios) return false
    const list = Array.isArray(portfolios) ? portfolios : (portfolios as any).data ?? []
    if (list.length === 0) return false
    const latest = list[list.length - 1]
    return latest?.autoRebalance === true
  }, [portfolios])

  const allCompleted = publicKey && hasPortfolio && hasAllocations && hasRebalanced && hasAutoRebalance

  const stepStatus = useCallback(
    (id: string) => {
      switch (id) {
        case 'connect-wallet':
          return !!publicKey
        case 'create-portfolio':
          return hasPortfolio
        case 'set-allocations':
          return hasAllocations
        case 'execute-rebalance':
          return hasRebalanced
        case 'enable-auto-rebalance':
          return hasAutoRebalance
        default:
          return false
      }
    },
    [publicKey, hasPortfolio, hasAllocations, hasRebalanced, hasAutoRebalance]
  )

  useEffect(() => {
    if (!dismissed && !hasAutoShown && !allCompleted) {
      const timer = setTimeout(() => setOpen(true), 800)
      setHasAutoShown(true)
      return () => clearTimeout(timer)
    }
  }, [dismissed, hasAutoShown, allCompleted])

  useEffect(() => {
    if (!open) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setDismissed(true)
        try {
          localStorage.setItem(DISMISSED_KEY, CHECKLIST_VERSION)
        } catch {}
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [open])

  const dismiss = useCallback(() => {
    setOpen(false)
    setDismissed(true)
    try {
      localStorage.setItem(DISMISSED_KEY, CHECKLIST_VERSION)
    } catch {}
  }, [])

  const toggle = useCallback(() => {
    setOpen((prev) => !prev)
  }, [])

  if (!open) {
    if (dismissed && !allCompleted) {
      return (
        <button
          type="button"
          onClick={toggle}
          className="fixed bottom-28 right-4 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-blue-300 bg-blue-50 text-blue-600 shadow-md hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900"
          aria-label="Open onboarding checklist"
          title="Getting started checklist"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      )
    }
    if (dismissed && allCompleted) {
      return null
    }
    return (
      <button
        type="button"
        onClick={toggle}
        className="fixed bottom-28 right-4 z-40 flex items-center gap-1.5 rounded-full border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 shadow-md hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900"
        aria-label="Open onboarding checklist"
      >
        <HelpCircle className="h-3.5 w-3.5" />
        Getting Started
      </button>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end bg-black/40 p-4"
      onClick={dismiss}
    >
      <div
        className="mt-16 mr-4 w-full max-w-sm rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Onboarding checklist"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-blue-600" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              Getting Started
            </h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss checklist"
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <ul className="space-y-1">
            {STEPS.map((step) => {
              const done = stepStatus(step.id)
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(step.href)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                      done
                        ? 'bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300'
                        : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    {done ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                    ) : (
                      <Circle className="h-5 w-5 shrink-0 text-gray-300 dark:text-gray-600" />
                    )}
                    <span className="flex-1">{step.label}</span>
                    {!done ? (
                      <ArrowRight className="h-4 w-4 shrink-0 text-gray-400" />
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>

          {allCompleted ? (
            <div className="mt-4 rounded-lg bg-green-50 px-4 py-3 dark:bg-green-950/30">
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                All steps complete! Your portfolio is fully set up.
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-lg bg-blue-50 px-4 py-3 dark:bg-blue-950/30">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Click any step to navigate to the relevant page. Press{' '}
                <kbd className="inline-flex items-center rounded border border-blue-200 bg-white px-1 py-0.5 font-mono text-xs dark:border-blue-800 dark:bg-blue-950">
                  Esc
                </kbd>{' '}
                or click outside to dismiss.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {STEPS.filter((s) => stepStatus(s.id)).length} of {STEPS.length} steps completed
          </p>
        </div>
      </div>
    </div>
  )
}

export default OnboardingChecklist
