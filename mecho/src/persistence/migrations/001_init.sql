CREATE TABLE IF NOT EXISTS core_memory (
  mode_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL CHECK(length(description) <= 1000),
  detail TEXT NOT NULL CHECK(length(detail) <= 3000),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS curated_memory (
  mode_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL CHECK(length(description) <= 500),
  detail TEXT NOT NULL CHECK(length(detail) <= 3000),
  is_deleted INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (mode_id, memory_id)
);

CREATE TABLE IF NOT EXISTS memory_revision (
  mode_id TEXT PRIMARY KEY,
  current_rev INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  memory_id TEXT,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_event_mode_rev ON memory_event(mode_id, rev);

CREATE TABLE IF NOT EXISTS session_sync (
  session_key TEXT PRIMARY KEY,
  mode_id TEXT NOT NULL,
  last_acked_rev INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_sync_mode ON session_sync(mode_id);

CREATE TABLE IF NOT EXISTS prepare_turn (
  prepare_id TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  mode_id TEXT NOT NULL,
  from_revision INTEGER NOT NULL,
  to_revision INTEGER NOT NULL,
  mode TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  acked_at INTEGER,
  ack_status TEXT
);

CREATE INDEX IF NOT EXISTS idx_prepare_turn_session ON prepare_turn(session_key, created_at DESC);
