import { useEffect, useMemo, useState } from 'react'
import { Lightbulb, Sparkles, X } from 'lucide-react'
import {
  buildPortfolioSuggestions,
  dismissPortfolioSuggestion,
  loadDismissedPortfolioSuggestions,
  PORTFOLIO_SUGGESTION_DISMISS_TTL_MS,
  type PortfolioSuggestion,
  type SuggestionAllocation,
  type SuggestionAsset,
  type SuggestionDismissalState,
} from '../utils/portfolioSuggestions'

interface PortfolioSuggestionsProps {
  allocations: SuggestionAllocation[]
  assets: SuggestionAsset[]
  publicKey: string | null
  onApply: (allocations: SuggestionAllocation[]) => void
}

const toneClasses: Record<PortfolioSuggestion['tone'], string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-100',
  warning: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-100',
}

const badgeClasses: Record<PortfolioSuggestion['tone'], string> = {
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
}

const PortfolioSuggestions: React.FC<PortfolioSuggestionsProps> = ({
  allocations,
  assets,
  publicKey,
  onApply,
}) => {
  const [dismissals, setDismissals] = useState<SuggestionDismissalState>(() =>
    loadDismissedPortfolioSuggestions(publicKey),
  )
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setDismissals(loadDismissedPortfolioSuggestions(publicKey))
  }, [publicKey])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [])

  const suggestions = useMemo(
    () => buildPortfolioSuggestions(allocations, assets),
    [allocations, assets],
  )

  const visibleSuggestions = useMemo(
    () =>
      suggestions.filter((suggestion) => {
        const dismissedAt = dismissals[suggestion.id]
        if (!dismissedAt) return true
        return now - dismissedAt >= PORTFOLIO_SUGGESTION_DISMISS_TTL_MS
      }),
    [suggestions, dismissals, now],
  )

  if (visibleSuggestions.length === 0) return null

  const handleDismiss = (suggestionId: string) => {
    const next = dismissPortfolioSuggestion(publicKey, suggestionId)
    setDismissals(next)
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-indigo-100 p-2 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Portfolio suggestions
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Rule-based ideas based on your current allocation mix.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {visibleSuggestions.map((suggestion) => (
          <article
            key={suggestion.id}
            className={`rounded-xl border p-4 ${toneClasses[suggestion.tone]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClasses[suggestion.tone]}`}>
                  <Lightbulb className="mr-1 inline-block h-3.5 w-3.5" />
                  Suggestion
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold">
                    {suggestion.title}
                  </h4>
                  <p className="mt-1 text-sm opacity-90">
                    {suggestion.description}
                  </p>
                  <p className="mt-2 text-xs opacity-75">
                    Why this appeared: {suggestion.rationale}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDismiss(suggestion.id)}
                className="rounded-full p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                aria-label={`Dismiss ${suggestion.title}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onApply(suggestion.allocations.map((allocation) => ({ ...allocation })))}
                className="inline-flex items-center rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                Apply
              </button>
              <div className="flex flex-wrap gap-2 text-xs text-inherit/80">
                {suggestion.allocations.map((allocation) => (
                  <span
                    key={`${suggestion.id}-${allocation.asset}`}
                    className="rounded-full border border-current/10 px-2 py-1"
                  >
                    {allocation.asset} {allocation.percentage}%
                  </span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export default PortfolioSuggestions
