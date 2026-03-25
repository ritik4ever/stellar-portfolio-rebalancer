/**
 * ConsentModal.tsx — ToS, Privacy, Cookie consent before using the app.
 * Users must accept all before proceeding. Links open Legal pages.
 */

import React, { useState } from 'react'
import { FileText, AlertCircle } from 'lucide-react'
import { api } from '../config/api'

interface ConsentModalProps {
    userId: string
    onAccept: () => void
    onOpenLegal: (doc: 'terms' | 'privacy' | 'cookies') => void
}

const ConsentModal: React.FC<ConsentModalProps> = ({ userId, onAccept, onOpenLegal }) => {
    const [terms, setTerms] = useState(false)
    const [privacy, setPrivacy] = useState(false)
    const [cookies, setCookies] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const allAccepted = terms && privacy && cookies

    const handleAccept = async () => {
        if (!allAccepted) return
        setSubmitting(true)
        setError(null)
        try {
            await api.post('/api/consent', {
                userId,
                terms: true,
                privacy: true,
                cookies: true
            })
            onAccept()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to save consent. Please try again.')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
                <div className="flex items-center gap-2 mb-4">
                    <AlertCircle className="w-6 h-6 text-amber-500 flex-shrink-0" />
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                        Accept to continue
                    </h2>
                </div>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-6">
                    To use the Portfolio Rebalancer you must accept the following. You can read each document before accepting.
                </p>
                <div className="space-y-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={terms}
                            onChange={(e) => setTerms(e.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-gray-700 dark:text-gray-300 text-sm">
                            I accept the{' '}
                            <button
                                type="button"
                                onClick={() => onOpenLegal('terms')}
                                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                            >
                                Terms of Service
                            </button>
                            {' '}(disclaimers, liability, smart contract risks).
                        </span>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={privacy}
                            onChange={(e) => setPrivacy(e.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-gray-700 dark:text-gray-300 text-sm">
                            I accept the{' '}
                            <button
                                type="button"
                                onClick={() => onOpenLegal('privacy')}
                                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                            >
                                Privacy Policy
                            </button>
                            {' '}(GDPR/CCPA compliant).
                        </span>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={cookies}
                            onChange={(e) => setCookies(e.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-gray-700 dark:text-gray-300 text-sm">
                            I accept the{' '}
                            <button
                                type="button"
                                onClick={() => onOpenLegal('cookies')}
                                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                            >
                                Cookie Policy
                            </button>.
                        </span>
                    </label>
                </div>
                {error && (
                    <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-800 dark:text-red-300 text-sm flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        {error}
                    </div>
                )}
                <div className="mt-6 flex justify-end">
                    <button
                        type="button"
                        onClick={handleAccept}
                        disabled={!allAccepted || submitting}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                    >
                        {submitting ? 'Saving...' : 'Accept and continue'}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default ConsentModal
