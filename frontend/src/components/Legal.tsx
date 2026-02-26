/**
 * Legal.tsx — Terms of Service, Privacy Policy, Cookie Policy.
 * Rendered as /legal pages (doc query: terms | privacy | cookies).
 */

import React from 'react'
import { ArrowLeft, FileText } from 'lucide-react'

export type LegalDocType = 'terms' | 'privacy' | 'cookies'

interface LegalProps {
    doc: LegalDocType
    onBack: () => void
}

const LEGAL_DOCS: Record<LegalDocType, { title: string; content: React.ReactNode }> = {
    terms: {
        title: 'Terms of Service',
        content: (
            <>
                <p className="mb-4 text-gray-600 dark:text-gray-400">Last updated: {new Date().toISOString().slice(0, 10)}</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">1. Acceptance</h2>
                <p className="mb-4">By connecting your wallet and using the Stellar Portfolio Rebalancer (“Service”), you agree to these Terms of Service. If you do not agree, do not use the Service.</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">2. Disclaimers</h2>
                <p className="mb-4">The Service is provided “as is” without warranties of any kind. We do not guarantee accuracy of prices, execution of rebalances, or availability. You use the Service at your own risk.</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">3. Smart contract and protocol risks</h2>
                <p className="mb-4">Rebalancing may involve smart contracts and on-chain transactions. You acknowledge risks including but not limited to: contract bugs, oracle inaccuracies, slippage, network congestion, and irreversible transactions. We are not liable for any losses arising from use of the Service or underlying protocols.</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">4. Financial and tax</h2>
                <p className="mb-4">The Service does not constitute financial, investment, or tax advice. You are solely responsible for your investment decisions and any tax obligations.</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">5. Limitation of liability</h2>
                <p className="mb-4">To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service.</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">6. Changes</h2>
                <p className="mb-4">We may update these Terms. Continued use after changes constitutes acceptance. We will indicate the last updated date at the top.</p>
            </>
        )
    },
    privacy: {
        title: 'Privacy Policy',
        content: (
            <>
                <p className="mb-4 text-gray-600 dark:text-gray-400">Last updated: {new Date().toISOString().slice(0, 10)}. This policy is GDPR and CCPA compliant where applicable.</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">1. Data we collect</h2>
                <p className="mb-4">We collect: (a) wallet public address when you connect; (b) portfolio configuration and rebalance history you create; (c) consent timestamps and IP/user agent for legal compliance; (d) notification preferences if you opt in.</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">2. Purpose and legal basis</h2>
                <p className="mb-4">We process data to provide the Service, comply with legal obligations (e.g. consent records), and improve the product. Legal bases: contract performance, consent, and legitimate interest.</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">3. Your rights (GDPR / CCPA)</h2>
                <p className="mb-4">You have the right to: access your data, export your data (via the in-app export feature), rectify inaccuracies, request deletion of your data, object to processing, and withdraw consent. To exercise these rights, use the “Export my data” and “Delete my data” options in the dashboard or contact us.</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">4. Data retention</h2>
                <p className="mb-4">We retain your data until you request deletion or we no longer need it for the purposes stated. Consent records may be retained as required for legal compliance.</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">5. Security and sharing</h2>
                <p className="mb-4">We implement appropriate technical and organizational measures to protect your data. We do not sell your personal data. We may share data with service providers (e.g. hosting) under strict agreements.</p>
            </>
        )
    },
    cookies: {
        title: 'Cookie Policy',
        content: (
            <>
                <p className="mb-4 text-gray-600 dark:text-gray-400">Last updated: {new Date().toISOString().slice(0, 10)}</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">1. What we use</h2>
                <p className="mb-4">We use strictly necessary cookies and local storage to: keep you logged in (e.g. JWT), remember your consent choices, and store preferences. We do not use third-party advertising cookies.</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">2. Your control</h2>
                <p className="mb-4">You can withdraw cookie consent via the consent banner or by clearing site data. Note that rejecting necessary cookies may prevent the Service from functioning.</p>
                <h2 className="text-xl font-semibold mt-6 mb-2">3. Updates</h2>
                <p className="mb-4">We may update this Cookie Policy. We will indicate the last updated date at the top.</p>
            </>
        )
    }
}

const Legal: React.FC<LegalProps> = ({ doc, onBack }) => {
    const { title, content } = LEGAL_DOCS[doc]
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <button
                    onClick={onBack}
                    className="flex items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-6"
                >
                    <ArrowLeft className="w-5 h-5 mr-2" />
                    Back
                </button>
                <div className="flex items-center gap-2 mb-6">
                    <FileText className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{title}</h1>
                </div>
                <article className="bg-white dark:bg-gray-800 rounded-xl p-8 shadow-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                    {content}
                </article>
                <div className="mt-6 flex gap-4 text-sm">
                    <button type="button" onClick={onBack} className="text-blue-600 dark:text-blue-400 hover:underline">Back to app</button>
                </div>
            </div>
        </div>
    )
}

export default Legal
export { LEGAL_DOCS }
