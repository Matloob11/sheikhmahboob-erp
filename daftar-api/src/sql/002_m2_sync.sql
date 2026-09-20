-- M2: staff ↔ client assignment + updated_at helpers for sync.

CREATE TABLE IF NOT EXISTS client_staff (
  client_id text NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, user_id)
);
CREATE INDEX IF NOT EXISTS client_staff_user_id_idx ON client_staff (user_id);

-- Sync cursors (optional client-side bookkeeping mirrored for debugging)
CREATE TABLE IF NOT EXISTS sync_cursors (
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  resource text NOT NULL,
  cursor_ms bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, resource)
);
