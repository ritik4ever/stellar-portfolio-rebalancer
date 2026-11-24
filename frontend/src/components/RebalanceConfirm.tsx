import { useEffect, useState, useRef } from 'react'
import { useRebalancePlan } from '../hooks/queries/usePortfolioQuery'
import { useExecuteRebalanceMutation } from '../hooks/mutations/usePortfolioMutations'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'

interface RebalanceConfirmProps {
    portfolioId: string | null
    open: boolean
    onClose: () => void
    onSuccess?: (result: any) => void
}

export default function RebalanceConfirm({ open, ...props }: RebalanceConfirmProps) {
    return open ? <RebalanceReview key={props.portfolioId} {...props} /> : null
}

function RebalanceReview({ portfolioId, onClose, onSuccess }: Omit<RebalanceConfirmProps, 'open'>) {
    const { data: plan, isLoading, isFetching, isError, refetch } = useRebalancePlan(portfolioId)
    const execute = useExecuteRebalanceMutation(portfolioId)
    const [reviewedPlan, setReviewedPlan] = useState<typeof plan>()
    const [executionError, setExecutionError] = useState<string | null>(null)
    const [statusAnnouncement, setStatusAnnouncement] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const submittingRef = useRef(false)
    const errorAlertRef = useRef<HTMLDivElement>(null)
    const [now, setNow] = useState(Date.now)

    useEffect(() => {
        if (executionError) {
            errorAlertRef.current?.focus()
        }
    }, [executionError])

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 15000)
        return () => clearInterval(timer)
    }, [])
    const trades = plan?.boundary.trades ?? []
    const fees = plan?.estimatedFees
    const quote = plan?.boundary.quoteSnapshot
    const requiredQuotes = new Set(trades.map(({ asset }) => asset))
    if (fees && fees.xlm > 0) requiredQuotes.add('XLM')
    const quoteDates = Array.from(requiredQuotes, asset => {
        const timestamp = quote?.prices?.[asset]?.timestamp
        if (!timestamp || timestamp <= 0) return NaN
        return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).getTime()
    })
    const oldestQuoteMs = quoteDates.length > 0 && quoteDates.every(Number.isFinite) ? Math.min(...quoteDates) : null
    const quoteAgeMinutes = oldestQuoteMs === null ? null : Math.max(0, Math.floor((now - oldestQuoteMs) / 60000))
    const hasTrades = trades.length > 0
    const confirmed = !!plan && reviewedPlan === plan
    const inFlight = isSubmitting || execute.isPending
    const canConfirm = hasTrades && confirmed && !isFetching && !isError && !inFlight

    const handleConfirm = async () => {
        if (submittingRef.current || inFlight) {
            setStatusAnnouncement('Rebalance submission is already in progress.')
            return
        }
        if (!canConfirm) return
        submittingRef.current = true
        setIsSubmitting(true)
        setExecutionError(null)
        setStatusAnnouncement('Submitting rebalance…')
        try {
            const result = await execute.mutateAsync()
            submittingRef.current = false
            setIsSubmitting(false)
            onSuccess?.(result)
            onClose()
        } catch (error) {
            submittingRef.current = false
            setIsSubmitting(false)
            setReviewedPlan(undefined)
            setStatusAnnouncement(null)
            setExecutionError(error instanceof Error ? error.message : 'Rebalance failed. Please try again.')
        }
    }

    return (
        <Modal
            open
            title="Review rebalance"
            onClose={() => { if (!inFlight) onClose() }}
            footer={(
                <>
                    <Button variant="secondary" onClick={onClose} disabled={inFlight}>
                        {plan && !hasTrades ? 'Close' : 'Cancel'}
                    </Button>
                    {hasTrades && !isError && (
                        <Button
                            variant="primary"
                            onClick={handleConfirm}
                            disabled={!canConfirm}
                            loading={inFlight}
                            aria-busy={inFlight}
                            aria-label={inFlight ? 'Submitting rebalance…' : 'Confirm rebalance'}
                        >
                            {inFlight ? 'Submitting rebalance…' : 'Confirm rebalance'}
                        </Button>
                    )}
                </>
            )}
        >
            {statusAnnouncement && (
                <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                    {statusAnnouncement}
                </div>
            )}
            {isLoading ? (
                <p role="status">Loading rebalance plan…</p>
            ) : isError || !plan || !fees ? (
                <>
                    <p role="alert">The rebalance plan is unavailable.</p>
                    <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
                        Retry loading plan
                    </Button>
                </>
            ) : !hasTrades ? (
                <p role="status">
                    {plan.boundary.reasonCode === 'WITHIN_EVERY_THRESHOLD'
                        ? 'All allocations are within the drift threshold. No trades are required and there is no network fee.'
                        : 'This plan contains no executable trades. Close the review and try again when quotes or balances change.'}
                </p>
            ) : (
                <div className="max-h-[65vh] space-y-3 overflow-y-auto text-sm">
                    <h3 id="quoted-trades" className="font-semibold">
                        {trades.length} planned {trades.length === 1 ? 'trade' : 'trades'}
                    </h3>
                    {trades.length > 4 && <p>Scroll the trade list to review all planned trades.</p>}
                    <div role="region" tabIndex={0} aria-labelledby="quoted-trades"
                        className="max-h-36 overflow-y-auto rounded bg-gray-50 p-2 focus-visible:ring-2 dark:bg-gray-900">
                        <ol className="list-decimal space-y-1 pl-6">
                            {trades.map(trade => (
                                <li key={trade.asset}>
                                    {trade.action === 'buy' ? 'Buy' : 'Sell'} {trade.amount.toLocaleString(undefined, { maximumFractionDigits: 7 })} {trade.asset}
                                </li>
                            ))}
                        </ol>
                    </div>
                    <p>Estimated network fee for all trades: {fees.xlm.toFixed(7)} XLM (~${fees.usd.toFixed(3)})</p>
                    <p>
                        {oldestQuoteMs === null
                            ? 'Price age unavailable for one or more quotes.'
                            : <>Oldest quoted price as of <time dateTime={new Date(oldestQuoteMs).toISOString()}>{new Date(oldestQuoteMs).toLocaleString()}</time> ({quoteAgeMinutes === 0 ? 'less than 1 minute old' : `${quoteAgeMinutes} min old`}).</>}
                    </p>
                    {quote?.feedMeta.degraded && <p>Some prices use a fallback feed.</p>}
                    {quote?.feedMeta.staleOrLimited && <p>Some quoted prices may be stale.</p>}
                    <p>Maximum slippage: {plan.maxSlippagePercent}%</p>
                    <p>The execution price and fees may change. Executed trades cannot be reversed from this app.</p>
                    <label className="flex items-start gap-2">
                        <input type="checkbox" checked={confirmed} disabled={isFetching || inFlight}
                            onChange={event => setReviewedPlan(event.target.checked ? plan : undefined)} />
                        I reviewed the planned trades, fees, and prices.
                    </label>
                </div>
            )}
            {executionError && (
                <div
                    ref={errorAlertRef}
                    role="alert"
                    tabIndex={-1}
                    className="mt-3 rounded border border-red-200 bg-red-50 p-2.5 text-sm text-red-700 outline-none focus:ring-2 focus:ring-red-500 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                >
                    <p className="font-semibold">Rebalance submission failed</p>
                    <p>{executionError}</p>
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        Review and re-acknowledge the planned trades to retry, or cancel to abandon.
                    </p>
                </div>
            )}
        </Modal>
    )
}
