-- Migration: 012_consent_policy_versions (up)
-- Description: Store legal document versions on consent records and audit events.

ALTER TABLE legal_consent
    ADD COLUMN IF NOT EXISTS policy_versions TEXT;

ALTER TABLE consent_audit_events
    ADD COLUMN IF NOT EXISTS policy_versions TEXT;
