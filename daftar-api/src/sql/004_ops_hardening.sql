-- Ops hardening: disable staff accounts; go-live flags live on clients via JSON later if needed.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;
