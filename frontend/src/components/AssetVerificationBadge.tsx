import React from 'react'
import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react'

export type AssetVerificationStatus = 'pending' | 'verified' | 'rejected'

interface AssetVerificationBadgeProps {
  status?: AssetVerificationStatus
  /** Verified assets are the norm, so their badge is hidden unless explicitly asked for. */
  showVerified?: boolean
  className?: string
}

const BADGE_STYLES: Record<AssetVerificationStatus, string> = {
  verified: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300',
  pending: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300',
  rejected: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300',
}

const BADGE_LABELS: Record<AssetVerificationStatus, string> = {
  verified: 'Verified issuer',
  pending: 'Unverified issuer',
  rejected: 'Rejected issuer',
}

const BADGE_TITLES: Record<AssetVerificationStatus, string> = {
  verified: 'This asset issuer has been reviewed and approved by an admin.',
  pending: 'This issuer is awaiting admin review. Trade with caution.',
  rejected: 'This issuer was reviewed and rejected by an admin.',
}

/**
 * Flags an asset's issuer-verification state (#1412) so unverified assets are
 * never presented as though they were trusted.
 */
export function AssetVerificationBadge({
  status,
  showVerified = false,
  className = '',
}: AssetVerificationBadgeProps): React.ReactElement | null {
  // Assets predating the workflow report no status; treat them as verified.
  const effective: AssetVerificationStatus = status ?? 'verified'
  if (effective === 'verified' && !showVerified) return null

  const Icon = effective === 'verified' ? ShieldCheck : effective === 'pending' ? ShieldAlert : ShieldX

  return (
    <span
      title={BADGE_TITLES[effective]}
      data-testid={`asset-verification-${effective}`}
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${BADGE_STYLES[effective]} ${className}`}
    >
      <Icon className="w-3 h-3" />
      {BADGE_LABELS[effective]}
    </span>
  )
}

export default AssetVerificationBadge
