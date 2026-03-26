import { useState } from 'react'
import { Bell, Send, CheckCircle, XCircle, Loader } from 'lucide-react'
import { api } from '../config/api'

interface NotificationTestProps {
  userId: string
}

type EventType = 'rebalance' | 'circuitBreaker' | 'priceMovement' | 'riskChange'

interface TestResult {
  success: boolean
  message: string
  sentTo: {
    email: string | null
    webhook: string | null
  }
  timestamp: string
}

export function NotificationTest({ userId }: NotificationTestProps) {
  const [testing, setTesting] = useState<EventType | null>(null)
  const [testResults, setTestResults] = useState<Record<EventType, TestResult | null>>({
    rebalance: null,
    circuitBreaker: null,
    priceMovement: null,
    riskChange: null
  })
  const [error, setError] = useState<string>('')
  const [testingAll, setTestingAll] = useState(false)

  const eventTypes: { type: EventType; label: string; description: string; icon: string }[] = [
    {
      type: 'rebalance',
      label: 'Rebalance',
      description: 'Portfolio rebalanced with trades executed',
      icon: '🔄'
    },
    {
      type: 'circuitBreaker',
      label: 'Circuit Breaker',
      description: 'Circuit breaker triggered due to volatility',
      icon: '⚠️'
    },
    {
      type: 'priceMovement',
      label: 'Price Movement',
      description: 'Large price movement detected',
      icon: '📈'
    },
    {
      type: 'riskChange',
      label: 'Risk Change',
      description: 'Portfolio risk level changed',
      icon: '🎯'
    }
  ]

  const testNotification = async (eventType: EventType) => {
    setTesting(eventType)
    setError('')

    try {
      const data = await api.post<{
        message: string
        sentTo: { email: string | null; webhook: string | null }
        timestamp: string
      }>('/api/notifications/test', {
        userId,
        eventType
      })

      setTestResults(prev => ({
        ...prev,
        [eventType]: {
          success: true,
          message: data.message,
          sentTo: data.sentTo,
          timestamp: data.timestamp
        }
      }))
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMessage)
      setTestResults(prev => ({
        ...prev,
        [eventType]: {
          success: false,
          message: errorMessage,
          sentTo: { email: null, webhook: null },
          timestamp: new Date().toISOString()
        }
      }))
    } finally {
      setTesting(null)
    }
  }

  const testAllNotifications = async () => {
    setTestingAll(true)
    setError('')
    setTestResults({
      rebalance: null,
      circuitBreaker: null,
      priceMovement: null,
      riskChange: null
    })

    try {
      const data = await api.post<{
        results: Array<{ eventType: EventType; success: boolean; error?: string; sentTo?: { email: string | null; webhook: string | null }; timestamp: string }>
      }>('/api/notifications/test-all', { userId })

      // Update results for each event type
      const newResults: Record<EventType, TestResult | null> = {
        rebalance: null,
        circuitBreaker: null,
        priceMovement: null,
        riskChange: null
      }

      data.results.forEach((result: any) => {
        newResults[result.eventType as EventType] = {
          success: result.success,
          message: result.success ? 'Test notification sent' : result.error,
          sentTo: result.sentTo || { email: null, webhook: null },
          timestamp: result.timestamp
        }
      })

      setTestResults(newResults)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMessage)
    } finally {
      setTestingAll(false)
    }
  }

  const clearResults = () => {
    setTestResults({
      rebalance: null,
      circuitBreaker: null,
      priceMovement: null,
      riskChange: null
    })
    setError('')
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell className="w-6 h-6 text-blue-600" />
          <h2 className="text-2xl font-bold text-gray-900">Test Notifications</h2>
        </div>
        <button
          onClick={clearResults}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          Clear Results
        </button>
      </div>

      <p className="text-gray-600 mb-6">
        Send test notifications to verify your email and webhook configurations are working correctly.
      </p>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-900">Error</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Test All Button */}
      <div className="mb-6">
        <button
          onClick={testAllNotifications}
          disabled={testingAll}
          className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 font-medium"
        >
          {testingAll ? (
            <>
              <Loader className="w-5 h-5 animate-spin" />
              Testing All Notifications...
            </>
          ) : (
            <>
              <Send className="w-5 h-5" />
              Test All Notification Types
            </>
          )}
        </button>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Individual Tests</h3>
        <div className="space-y-4">
          {eventTypes.map(({ type, label, description, icon }) => {
            const result = testResults[type]
            const isLoading = testing === type

            return (
              <div
                key={type}
                className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-2xl">{icon}</span>
                      <h4 className="font-semibold text-gray-900">{label}</h4>
                    </div>
                    <p className="text-sm text-gray-600">{description}</p>

                    {result && (
                      <div className="mt-3 space-y-2">
                        <div className={`flex items-start gap-2 text-sm ${result.success ? 'text-green-700' : 'text-red-700'}`}>
                          {result.success ? (
                            <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          ) : (
                            <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          )}
                          <span>{result.message}</span>
                        </div>

                        {result.success && (result.sentTo.email || result.sentTo.webhook) && (
                          <div className="text-xs text-gray-600 ml-6">
                            <p className="font-medium mb-1">Sent to:</p>
                            {result.sentTo.email && (
                              <p>📧 Email: {result.sentTo.email}</p>
                            )}
                            {result.sentTo.webhook && (
                              <p>🔗 Webhook: {result.sentTo.webhook}</p>
                            )}
                          </div>
                        )}

                        <p className="text-xs text-gray-500 ml-6">
                          {new Date(result.timestamp).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => testNotification(type)}
                    disabled={isLoading || testingAll}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2 text-sm font-medium"
                  >
                    {isLoading ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Test
                      </>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-900">
          <strong>Note:</strong> Make sure you have saved your notification preferences before testing.
          Test notifications will be sent to your configured email address and/or webhook URL.
        </p>
      </div>
    </div>
  )
}
