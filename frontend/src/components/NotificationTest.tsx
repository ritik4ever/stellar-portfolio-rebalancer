import { useState } from 'react'
import { Send, CheckCircle, XCircle, Loader, RefreshCw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    useTestNotificationMutation,
    useTestAllNotificationsMutation,
} from '../hooks/mutations/useNotificationMutations'
import type { EventType, TestNotificationResult } from '../hooks/mutations/useNotificationMutations'

interface NotificationTestProps {
    userId: string
    /** When false the component shows an empty state prompting the user to configure a provider first. */
    hasConfiguredProvider?: boolean
}

interface PerEventState {
    result: (TestNotificationResult & { success: boolean }) | null
    error: string | null
}

const EMPTY_EVENT_STATE: PerEventState = { result: null, error: null }

const EVENT_TYPES: { type: EventType; label: string; description: string; icon: string }[] = [
    {
        type: 'rebalance',
        label: 'Rebalance',
        description: 'Portfolio rebalanced with trades executed',
        icon: '🔄',
    },
    {
        type: 'circuitBreaker',
        label: 'Circuit Breaker',
        description: 'Circuit breaker triggered due to volatility',
        icon: '⚠️',
    },
    {
        type: 'priceMovement',
        label: 'Price Movement',
        description: 'Large price movement detected',
        icon: '📈',
    },
    {
        type: 'riskChange',
        label: 'Risk Change',
        description: 'Portfolio risk level changed',
        icon: '🎯',
    },
]

function buildEmptyStates(): Record<EventType, PerEventState> {
    return {
        rebalance: { ...EMPTY_EVENT_STATE },
        circuitBreaker: { ...EMPTY_EVENT_STATE },
        priceMovement: { ...EMPTY_EVENT_STATE },
        riskChange: { ...EMPTY_EVENT_STATE },
    }
}

export function NotificationTest({ userId, hasConfiguredProvider = true }: NotificationTestProps) {
    const [eventStates, setEventStates] = useState<Record<EventType, PerEventState>>(
        buildEmptyStates()
    )
    const [testingEvent, setTestingEvent] = useState<EventType | null>(null)
    const [testAllError, setTestAllError] = useState<string | null>(null)

    const testOneMutation = useTestNotificationMutation(userId)
    const testAllMutation = useTestAllNotificationsMutation(userId)

    const testingAll = testAllMutation.isPending

    const handleTestOne = async (eventType: EventType) => {
        setTestingEvent(eventType)
        // Clear previous result for this event so the user sees fresh feedback
        setEventStates(prev => ({
            ...prev,
            [eventType]: EMPTY_EVENT_STATE,
        }))

        try {
            const data = await testOneMutation.mutateAsync(eventType)
            setEventStates(prev => ({
                ...prev,
                [eventType]: {
                    result: { success: true, ...data },
                    error: null,
                },
            }))
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error'
            setEventStates(prev => ({
                ...prev,
                [eventType]: {
                    result: {
                        success: false,
                        message,
                        sentTo: { email: null, webhook: null },
                        timestamp: new Date().toISOString(),
                    },
                    error: message,
                },
            }))
        } finally {
            setTestingEvent(null)
        }
    }

    const handleTestAll = async () => {
        setTestAllError(null)
        setEventStates(buildEmptyStates())

        try {
            const data = await testAllMutation.mutateAsync()
            const next = buildEmptyStates()

            data.results.forEach(r => {
                next[r.eventType] = {
                    result: {
                        success: r.success,
                        message: r.success ? 'Test notification sent' : (r.error ?? 'Failed'),
                        sentTo: r.sentTo ?? { email: null, webhook: null },
                        timestamp: r.timestamp,
                    },
                    error: r.success ? null : (r.error ?? 'Failed'),
                }
            })

            setEventStates(next)
        } catch (err) {
            setTestAllError(err instanceof Error ? err.message : 'Unknown error')
        }
    }

    const handleClearAll = () => {
        setEventStates(buildEmptyStates())
        setTestAllError(null)
    }

    // ── Empty state: no provider configured ──────────────────────────────────
    if (!hasConfiguredProvider) {
        return (
            <div
                role="status"
                aria-label="Notification test unavailable"
                className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg text-center"
            >
                <p className="text-sm text-gray-600">
                    Save at least one notification provider (email or webhook) to send test
                    notifications.
                </p>
            </div>
        )
    }

    const anyResult = Object.values(eventStates).some(s => s.result !== null)

    return (
        <section aria-label="Test notifications" className="mt-6 border-t border-gray-200 pt-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900">Test Delivery</h3>
                {anyResult && (
                    <button
                        onClick={handleClearAll}
                        className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                        aria-label="Clear all test results"
                    >
                        Clear results
                    </button>
                )}
            </div>

            <p className="text-sm text-gray-600 mb-4">
                Send a test notification to verify your configured providers are working.
            </p>

            {/* Test-all error banner */}
            <AnimatePresence>
                {testAllError && (
                    <motion.div
                        key="test-all-error"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        role="alert"
                        className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 text-red-800"
                    >
                        <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                        <span className="text-sm">{testAllError}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Test-all button */}
            <button
                onClick={handleTestAll}
                disabled={testingAll || testingEvent !== null}
                aria-busy={testingAll}
                className="w-full mb-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 text-sm font-medium"
            >
                {testingAll ? (
                    <>
                        <Loader className="w-4 h-4 animate-spin" aria-hidden="true" />
                        Testing all…
                    </>
                ) : (
                    <>
                        <Send className="w-4 h-4" aria-hidden="true" />
                        Test all notification types
                    </>
                )}
            </button>

            {/* Per-event rows */}
            <ul className="space-y-3" aria-label="Individual notification tests">
                {EVENT_TYPES.map(({ type, label, description, icon }) => {
                    const { result, error } = eventStates[type]
                    const isLoading = testingEvent === type

                    return (
                        <li
                            key={type}
                            className="border border-gray-200 rounded-lg p-3 hover:border-blue-200 transition-colors"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <span aria-hidden="true">{icon}</span>
                                        <span className="font-medium text-sm text-gray-900">
                                            {label}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500">{description}</p>

                                    {/* Inline result */}
                                    <AnimatePresence>
                                        {result && (
                                            <motion.div
                                                key={`result-${type}`}
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="mt-2 overflow-hidden"
                                            >
                                                <div
                                                    role="status"
                                                    aria-label={`${label} test result`}
                                                    className={`flex items-start gap-1.5 text-xs ${
                                                        result.success
                                                            ? 'text-green-700'
                                                            : 'text-red-700'
                                                    }`}
                                                >
                                                    {result.success ? (
                                                        <CheckCircle
                                                            className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
                                                            aria-hidden="true"
                                                        />
                                                    ) : (
                                                        <XCircle
                                                            className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
                                                            aria-hidden="true"
                                                        />
                                                    )}
                                                    <span>{result.message}</span>
                                                </div>

                                                {result.success &&
                                                    (result.sentTo.email ||
                                                        result.sentTo.webhook) && (
                                                        <div className="mt-1 ml-5 text-xs text-gray-500 space-y-0.5">
                                                            {result.sentTo.email && (
                                                                <p>
                                                                    📧{' '}
                                                                    <span className="font-medium">
                                                                        Email:
                                                                    </span>{' '}
                                                                    {result.sentTo.email}
                                                                </p>
                                                            )}
                                                            {result.sentTo.webhook && (
                                                                <p>
                                                                    🔗{' '}
                                                                    <span className="font-medium">
                                                                        Webhook:
                                                                    </span>{' '}
                                                                    {result.sentTo.webhook}
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}

                                                <p className="mt-1 ml-5 text-xs text-gray-400">
                                                    {new Date(result.timestamp).toLocaleString()}
                                                </p>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                {/* Test / Retry button */}
                                <button
                                    onClick={() => handleTestOne(type)}
                                    disabled={isLoading || testingAll}
                                    aria-busy={isLoading}
                                    aria-label={
                                        error
                                            ? `Retry ${label} test`
                                            : result
                                              ? `Re-test ${label}`
                                              : `Test ${label}`
                                    }
                                    className="flex-shrink-0 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 text-xs font-medium"
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader
                                                className="w-3.5 h-3.5 animate-spin"
                                                aria-hidden="true"
                                            />
                                            Testing…
                                        </>
                                    ) : error ? (
                                        <>
                                            <RefreshCw
                                                className="w-3.5 h-3.5"
                                                aria-hidden="true"
                                            />
                                            Retry
                                        </>
                                    ) : (
                                        <>
                                            <Send className="w-3.5 h-3.5" aria-hidden="true" />
                                            {result ? 'Re-test' : 'Test'}
                                        </>
                                    )}
                                </button>
                            </div>
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}
