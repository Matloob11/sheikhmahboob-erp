-- M3: server-side PRA posting queue + per-client posting mode.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS posting_mode text NOT NULL DEFAULT 'browser'
    CHECK (posting_mode IN ('browser', 'server'));

CREATE TABLE IF NOT EXISTS post_queue (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  invoice_id text NOT NULL,
  usin text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  pos_id text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('pending', 'sending', 'posted', 'failed', 'unknown')),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  fiscal_number text NOT NULL DEFAULT '',
  last_code text NOT NULL DEFAULT '',
  last_error text NOT NULL DEFAULT '',
  last_response text NOT NULL DEFAULT '',
  actor_user_id text REFERENCES users (id) ON DELETE SET NULL,
  claimed_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, usin)
);

CREATE INDEX IF NOT EXISTS post_queue_status_created_idx
  ON post_queue (status, created_at);
CREATE INDEX IF NOT EXISTS post_queue_client_status_idx
  ON post_queue (client_id, status);

CREATE TABLE IF NOT EXISTS post_attempts (
  id text PRIMARY KEY,
  queue_id text NOT NULL REFERENCES post_queue (id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  usin text NOT NULL,
  actor_user_id text REFERENCES users (id) ON DELETE SET NULL,
  environment text NOT NULL,
  pos_id text NOT NULL DEFAULT '',
  payload_hash text NOT NULL,
  http_status integer,
  pra_code text NOT NULL DEFAULT '',
  raw_response text NOT NULL DEFAULT '',
  outcome text NOT NULL DEFAULT '',
  error_text text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS post_attempts_queue_id_idx ON post_attempts (queue_id);
CREATE INDEX IF NOT EXISTS post_attempts_client_at_idx ON post_attempts (client_id, at DESC);
