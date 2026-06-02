-- Migration: 010_consent_audit_lifecycle (up)
-- Description: Track active consent state and append-only grant/revoke audit events.

ALTER TABLE legal_consent
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE legal_consent
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS consent_audit_events (
    id          VARCHAR(64) PRIMARY KEY,
    user_id     VARCHAR(256) NOT NULL,
    action      VARCHAR(16) NOT NULL CHECK (action IN ('grant', 'revoke')),
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address  VARCHAR(64),
    user_agent  VARCHAR(512)
);

CREATE INDEX IF NOT EXISTS idx_consent_audit_events_user_timestamp
    ON consent_audit_events(user_id, timestamp);
