-- Migration: 008_legal_consent (up)
-- Description: Store user consent for Terms of Service, Privacy Policy, and Cookie Policy (GDPR/CCPA).
-- Rollback: See 008_legal_consent.down.sql

CREATE TABLE IF NOT EXISTS legal_consent (
    user_id                 VARCHAR(256) PRIMARY KEY,
    terms_accepted_at       TIMESTAMPTZ,
    privacy_accepted_at     TIMESTAMPTZ,
    cookie_accepted_at      TIMESTAMPTZ,
    ip_address              VARCHAR(64),
    user_agent              VARCHAR(512),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_consent_updated ON legal_consent(updated_at);

COMMENT ON TABLE legal_consent IS 'User acceptance of ToS, Privacy Policy, Cookie Policy for GDPR/CCPA compliance';
