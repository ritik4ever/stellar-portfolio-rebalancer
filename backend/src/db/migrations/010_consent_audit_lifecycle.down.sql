-- Migration: 010_consent_audit_lifecycle (down)

DROP INDEX IF EXISTS idx_consent_audit_events_user_timestamp;
DROP TABLE IF EXISTS consent_audit_events;

ALTER TABLE legal_consent
    DROP COLUMN IF EXISTS is_active;

ALTER TABLE legal_consent
    DROP COLUMN IF EXISTS revoked_at;
