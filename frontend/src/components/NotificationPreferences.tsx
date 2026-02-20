import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Bell, Mail, Webhook, Save, CheckCircle, AlertCircle, Loader, Send } from 'lucide-react'
import { API_CONFIG } from '../config/api'

interface NotificationPreferencesProps {
    userId: string
}

interface EventPreferences {
    rebalance: boolean
    circuitBreaker: boolean
    priceMovement: boolean
    riskChange: boolean
}

interface Preferences {
    emailEnabled: boolean
    emailAddress: string
    webhookEnabled: boolean
    webhookUrl: string
    events: EventPreferences
}

const NotificationPreferences: React.FC<NotificationPreferencesProps> = ({ userId }) => {
    const [preferences, setPreferences] = useState<Preferences>({
        emailEnabled: false,
        emailAddress: '',
        webhookEnabled: false,
        webhookUrl: '',
        events: {
            rebalance: true,
            circuitBreaker: true,
            priceMovement: true,
            riskChange: true
        }
    })

    const [originalPreferences, setOriginalPreferences] = useState<Preferences | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saveSuccess, setSaveSuccess] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [webhookError, setWebhookError] = useState<string | null>(null)
    const [emailError, setEmailError] = useState<string | null>(null)


    useEffect(() => {
        fetchPreferences()
    }, [userId])

    const fetchPreferences = async () => {
        try {
            setLoading(true)
            setError(null)

            const response = await fetch(
                `${API_CONFIG.BASE_URL}/api/notifications/preferences?userId=${encodeURIComponent(userId)}`
            )
            
            if (!response.ok) {
                throw new Error('Failed to fetch preferences')
            }

            const data = await response.json()

            if (data.success && data.preferences) {
                setPreferences(data.preferences)
                setOriginalPreferences(data.preferences)
            } else {
                // No preferences found, use defaults
                setOriginalPreferences(preferences)
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load preferences')
        } finally {
            setLoading(false)
        }
    }

    const validateWebhookUrl = (url: string): boolean => {
        if (!url) return true // Empty is valid when webhook is disabled

        try {
            const parsed = new URL(url)
            return parsed.protocol === 'http:' || parsed.protocol === 'https:'
        } catch {
            return false
        }
    }

    const validateEmail = (email: string): boolean => {
        if (!email) return true // Empty is valid when email is disabled
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    }

    const handleEmailAddressChange = (email: string) => {
        setPreferences(prev => ({ ...prev, emailAddress: email }))
        if (email && !validateEmail(email)) {
            setEmailError('Invalid email address format')
        } else {
            setEmailError(null)
        }
    }

    const handleWebhookUrlChange = (url: string) => {
        setPreferences(prev => ({ ...prev, webhookUrl: url }))
        
        if (url && !validateWebhookUrl(url)) {
            setWebhookError('Invalid URL format. Must start with http:// or https://')
        } else {
            setWebhookError(null)
        }
    }

    const handleSave = async () => {
        // Validate email address if email is enabled
        if (preferences.emailEnabled && !preferences.emailAddress) {
            setEmailError('Email address is required when email notifications are enabled')
            return
        }

        if (preferences.emailAddress && !validateEmail(preferences.emailAddress)) {
            setEmailError('Invalid email address format')
            return
        }

        // Validate webhook URL if webhook is enabled
        if (preferences.webhookEnabled && !preferences.webhookUrl) {
            setWebhookError('Webhook URL is required when webhook notifications are enabled')
            return
        }

        if (preferences.webhookUrl && !validateWebhookUrl(preferences.webhookUrl)) {
            setWebhookError('Invalid webhook URL format')
            return
        }

        setSaving(true)
        setError(null)
        setSaveSuccess(false)

        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/notifications/subscribe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId,
                    ...preferences
                })
            })

            if (!response.ok) {
                const data = await response.json()
                throw new Error(data.error || 'Failed to save preferences')
            }

            setOriginalPreferences(preferences)
            setSaveSuccess(true)

            // Hide success message after 3 seconds
            setTimeout(() => setSaveSuccess(false), 3000)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save preferences')
        } finally {
            setSaving(false)
        }
    }

    const handleUnsubscribe = async () => {
        if (!confirm('Are you sure you want to unsubscribe from all notifications?')) {
            return
        }

        setSaving(true)
        setError(null)

        try {
            const response = await fetch(
                `${API_CONFIG.BASE_URL}/api/notifications/unsubscribe?userId=${encodeURIComponent(userId)}`,
                { method: 'DELETE' }
            )

            if (!response.ok) {
                throw new Error('Failed to unsubscribe')
            }

            // Update local state
            setPreferences(prev => ({
                ...prev,
                emailEnabled: false,
                webhookEnabled: false
            }))
            setOriginalPreferences(prev => prev ? {
                ...prev,
                emailEnabled: false,
                webhookEnabled: false
            } : null)

            setSaveSuccess(true)
            setTimeout(() => setSaveSuccess(false), 3000)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to unsubscribe')
        } finally {
            setSaving(false)
        }
    }

    const hasUnsavedChanges = () => {
        if (!originalPreferences) return false
        return JSON.stringify(preferences) !== JSON.stringify(originalPreferences)
    }





    if (loading) {
        return (
            <div className="bg-white rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-center py-8">
                    <Loader className="w-6 h-6 animate-spin text-blue-500" />
                    <span className="ml-2 text-gray-600">Loading preferences...</span>
                </div>
            </div>
        )
    }

    return (
        <div className="bg-white rounded-xl p-6 shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                    <Bell className="w-6 h-6 text-blue-600 mr-2" />
                    <h2 className="text-xl font-semibold text-gray-900">Notifications</h2>
                </div>
                {hasUnsavedChanges() && (
                    <span className="text-sm text-orange-600 font-medium">Unsaved changes</span>
                )}
            </div>

            {/* Error Message */}
            {error && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-800"
                >
                    <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" />
                    <span className="text-sm">{error}</span>
                </motion.div>
            )}

            {/* Success Message */}
            {saveSuccess && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center text-green-800"
                >
                    <CheckCircle className="w-5 h-5 mr-2 flex-shrink-0" />
                    <span className="text-sm">Preferences saved successfully</span>
                </motion.div>
            )}


            

            {/* Provider Configuration */}
            <div className="space-y-6 mb-6">
                {/* Email Provider */}
                <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center">
                            <Mail className="w-5 h-5 text-gray-600 mr-2" />
                            <span className="font-medium text-gray-900">Email Notifications</span>
                        </div>
                        <button
                            onClick={() => setPreferences(prev => ({ ...prev, emailEnabled: !prev.emailEnabled }))}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                preferences.emailEnabled ? 'bg-blue-600' : 'bg-gray-300'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    preferences.emailEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                    <p className="text-sm text-gray-600 mb-3">
                        Receive notifications via email (requires SMTP configuration)
                    </p>

                    {preferences.emailEnabled && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Email Address
                            </label>
                            <input
                                type="email"
                                value={preferences.emailAddress}
                                onChange={(e) => handleEmailAddressChange(e.target.value)}
                                placeholder="your-email@example.com"
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    emailError ? 'border-red-300' : 'border-gray-300'
                                }`}
                            />
                            {emailError && (
                                <p className="mt-1 text-sm text-red-600">{emailError}</p>
                            )}
                            <p className="mt-1 text-xs text-gray-500">
                                Enter the email address where you want to receive notifications
                            </p>
                        </div>
                    )}
                </div>

                {/* Webhook Provider */}
                <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center">
                            <Webhook className="w-5 h-5 text-gray-600 mr-2" />
                            <span className="font-medium text-gray-900">Webhook Notifications</span>
                        </div>
                        <button
                            onClick={() => setPreferences(prev => ({ ...prev, webhookEnabled: !prev.webhookEnabled }))}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                preferences.webhookEnabled ? 'bg-blue-600' : 'bg-gray-300'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    preferences.webhookEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                    <p className="text-sm text-gray-600 mb-3">
                        Send notifications to your webhook endpoint via HTTP POST
                    </p>

                    {preferences.webhookEnabled && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Webhook URL
                            </label>
                            <input
                                type="url"
                                value={preferences.webhookUrl}
                                onChange={(e) => handleWebhookUrlChange(e.target.value)}
                                placeholder="https://your-domain.com/webhook"
                                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                    webhookError ? 'border-red-300' : 'border-gray-300'
                                }`}
                            />
                            {webhookError && (
                                <p className="mt-1 text-sm text-red-600">{webhookError}</p>
                            )}
                            <p className="mt-1 text-xs text-gray-500">
                                Must be a valid HTTP or HTTPS URL
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Event Toggles */}
            <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Event Types</h3>
                <div className="space-y-3">
                    <div className="flex items-center justify-between py-2">
                        <div className="flex-1">
                            <div className="font-medium text-gray-900">Rebalance Alerts</div>
                            <div className="text-sm text-gray-600">
                                Notify when portfolio is rebalanced
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                       
                            <button
                                onClick={() => setPreferences(prev => ({
                                    ...prev,
                                    events: { ...prev.events, rebalance: !prev.events.rebalance }
                                }))}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    preferences.events.rebalance ? 'bg-blue-600' : 'bg-gray-300'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        preferences.events.rebalance ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between py-2">
                        <div className="flex-1">
                            <div className="font-medium text-gray-900">Circuit Breaker Alerts</div>
                            <div className="text-sm text-gray-600">
                                Notify when circuit breakers are triggered
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          
                            <button
                                onClick={() => setPreferences(prev => ({
                                    ...prev,
                                    events: { ...prev.events, circuitBreaker: !prev.events.circuitBreaker }
                                }))}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    preferences.events.circuitBreaker ? 'bg-blue-600' : 'bg-gray-300'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        preferences.events.circuitBreaker ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between py-2">
                        <div className="flex-1">
                            <div className="font-medium text-gray-900">Large Price Movement Alerts</div>
                            <div className="text-sm text-gray-600">
                                Notify when asset prices move significantly
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                            
                            <button
                                onClick={() => setPreferences(prev => ({
                                    ...prev,
                                    events: { ...prev.events, priceMovement: !prev.events.priceMovement }
                                }))}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    preferences.events.priceMovement ? 'bg-blue-600' : 'bg-gray-300'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        preferences.events.priceMovement ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between py-2">
                        <div className="flex-1">
                            <div className="font-medium text-gray-900">Risk Level Change Alerts</div>
                            <div className="text-sm text-gray-600">
                                Notify when portfolio risk level changes
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                            
                            <button
                                onClick={() => setPreferences(prev => ({
                                    ...prev,
                                    events: { ...prev.events, riskChange: !prev.events.riskChange }
                                }))}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    preferences.events.riskChange ? 'bg-blue-600' : 'bg-gray-300'
                                }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                        preferences.events.riskChange ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                                />
                            </button>
                        </div>
                    </div>
                </div>

        
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <button
                    onClick={handleUnsubscribe}
                    disabled={saving || (!preferences.emailEnabled && !preferences.webhookEnabled)}
                    className="text-sm text-red-600 hover:text-red-700 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                    Unsubscribe from all
                </button>

                <button
                    onClick={handleSave}
                    disabled={saving || !hasUnsavedChanges() || (preferences.webhookEnabled && !!webhookError) || (preferences.emailEnabled && !!emailError)}
                    className="flex items-center px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                >
                    {saving ? (
                        <>
                            <Loader className="w-4 h-4 mr-2 animate-spin" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Save className="w-4 h-4 mr-2" />
                            Save Preferences
                        </>
                    )}
                </button>
            </div>
        </div>
    )
}

export default NotificationPreferences
