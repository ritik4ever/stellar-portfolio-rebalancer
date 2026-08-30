ALTER TABLE notification_logs DROP COLUMN IF EXISTS backoff_delay_ms;
ALTER TABLE notification_logs DROP COLUMN IF EXISTS attempt_number;
