-- Migration: 011_consent_document_version (up)
-- Description: Store a stable document version identifier (SHA-256 hash) with
--   each consent record and audit event so that accepted text is immutably
--   referenced. This makes consent records more trustworthy by linking each
--   grant/revoke action to a specific version of the legal document text.

ALTER TABLE legal_consent
    ADD COLUMN IF NOT EXISTS document_version VARCHAR(64);

ALTER TABLE consent_audit_events
    ADD COLUMN IF NOT EXISTS document_version VARCHAR(64);

COMMENT ON COLUMN legal_consent.document_version IS 'SHA-256 hash of the accepted legal document text at the time of consent';
COMMENT ON COLUMN consent_audit_events.document_version IS 'SHA-256 hash of the legal document text at the time of this audit event';
