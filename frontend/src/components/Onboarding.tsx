import { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react'

const STORAGE_KEY = 'onboarding-completed'
const STORAGE_VERSION = '1'

const ONBOARDING_STEPS = [
  {
    title: 'Connect Your Wallet',
    description:
      'Start by connecting your Stellar wallet (Freighter, Rabet, or xBull) to manage your portfolio. Your keys stay on your device.',
    targetId: 'onboarding-step-1',
  },
  {
    title: 'Create a Portfolio',
    description:
      'Set up your first portfolio by selecting assets and defining target allocation percentages that match your investment strategy.',
    targetId: 'onboarding-step-2',
  },
  {
    title: 'Set Allocations',
    description:
      'Distribute your capital across assets like XLM, USDC, BTC, and ETH. Drag to adjust percentages to match your risk tolerance.',
    targetId: 'onboarding-step-3',
  },
  {
    title: 'Enable Auto-Rebalance',
    description:
      'Turn on automatic rebalancing to keep your portfolio aligned with your targets. Set a threshold and let the system handle the trades.',
    targetId: 'onboarding-step-4',
  },
]

interface OnboardingProps {
  onDismiss?: () => void
}

function Onboarding({ onDismiss }: OnboardingProps) {
  const [step, setStep] = useState(0)
  const [completed, setCompleted] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === STORAGE_VERSION
    } catch {
      return false
    }
  })
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!completed) {
      const timer = setTimeout(() => setVisible(true), 500)
      return () => clearTimeout(timer)
    }
  }, [completed])

  const dismiss = useCallback(() => {
    setVisible(false)
    onDismiss?.()
  }, [onDismiss])

  const finish = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, STORAGE_VERSION)
    } catch {}
    setCompleted(true)
    setVisible(false)
    onDismiss?.()
  }, [onDismiss])

  const goNext = useCallback(() => {
    if (step < ONBOARDING_STEPS.length - 1) {
      setStep((s) => s + 1)
    } else {
      finish()
    }
  }, [step, finish])

  const goPrev = useCallback(() => {
    if (step > 0) {
      setStep((s) => s - 1)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [visible, dismiss, goNext, goPrev])

  if (!visible || completed) return null

  const current = ONBOARDING_STEPS[step]
  const isLast = step === ONBOARDING_STEPS.length - 1
  const isFirst = step === 0

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-4"
      onClick={dismiss}
      role="dialog"
      aria-label="Onboarding tour"
      aria-modal="true"
      aria-describedby="onboarding-description"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
              {step + 1}
            </span>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              {current.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss onboarding"
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-6">
          <div className="mb-8" id="onboarding-description">
            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              {current.description}
            </p>
          </div>

          <div className="mb-6 flex justify-center gap-1.5">
            {ONBOARDING_STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
                className={`h-2 rounded-full transition-all ${
                  i === step
                    ? 'w-6 bg-blue-600'
                    : i < step
                      ? 'w-2 bg-green-500'
                      : 'w-2 bg-gray-300 dark:bg-gray-600'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-5 py-4 dark:border-gray-700">
          <button
            type="button"
            onClick={dismiss}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {isLast ? 'Skip tour' : 'Skip'}
          </button>

          <div className="flex items-center gap-2">
            {!isFirst ? (
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous step"
                className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
            ) : null}

            <button
              type="button"
              onClick={goNext}
              aria-label={isLast ? 'Complete tour' : 'Next step'}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {isLast ? (
                <>
                  <Check className="h-4 w-4" />
                  Done
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function resetOnboarding(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

export function isOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === STORAGE_VERSION
  } catch {
    return false
  }
}

export default Onboarding
