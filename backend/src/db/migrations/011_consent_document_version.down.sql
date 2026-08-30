-- Migration: 011_consent_document_version (down)

ALTER TABLE consent_audit_events
    DROP COLUMN IF EXISTS document_version;

ALTER TABLE legal_consent
    DROP COLUMN IF EXISTS document_version;
