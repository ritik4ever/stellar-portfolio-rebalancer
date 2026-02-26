/**
 * ConsentGate.tsx — Full-page gate when user must accept ToS/Privacy/Cookies before using the app.
 * Renders ConsentModal on a full-page background (reconnect or first-time flow).
 */

import React from 'react'
import ConsentModal from './ConsentModal'
import type { LegalDocType } from './Legal'

interface ConsentGateProps {
    userId: string
    onAccept: () => void
    onOpenLegal: (doc: LegalDocType) => void
}

const ConsentGate: React.FC<ConsentGateProps> = ({ userId, onAccept, onOpenLegal }) => {
    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center p-4">
            <ConsentModal
                userId={userId}
                onAccept={onAccept}
                onOpenLegal={onOpenLegal}
            />
        </div>
    )
}

export default ConsentGate
