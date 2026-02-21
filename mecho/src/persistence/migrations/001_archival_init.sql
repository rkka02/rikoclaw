CREATE TABLE IF NOT EXISTS archival_memory (
  memory_id TEXT PRIMARY KEY,
  mode_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  detail TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  embedding_norm REAL NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archival_memory_mode_updated ON archival_memory(mode_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_archival_memory_mode_dim ON archival_memory(mode_id, embedding_dim);
