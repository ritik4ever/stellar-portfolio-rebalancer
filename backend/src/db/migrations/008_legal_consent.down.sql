-- Migration: 008_legal_consent (down)
DROP INDEX IF EXISTS idx_legal_consent_updated;
DROP TABLE IF EXISTS legal_consent;
