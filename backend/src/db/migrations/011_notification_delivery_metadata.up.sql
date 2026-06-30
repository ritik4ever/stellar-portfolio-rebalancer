ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS attempt_number INTEGER;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS backoff_delay_ms INTEGER;
