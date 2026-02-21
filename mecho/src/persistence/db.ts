import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const migrationSql = fs.readFileSync(
  new URL("./migrations/001_init.sql", import.meta.url),
  "utf8",
);
const archivalMigrationSql = fs.readFileSync(
  new URL("./migrations/001_archival_init.sql", import.meta.url),
  "utf8",
);

const cache = new Map<string, Database.Database>();
const archivalCache = new Map<string, Database.Database>();

export function getModeDb(modeIdRaw: string, dataDir: string): { modeId: string; db: Database.Database } {
  const modeId = sanitizeModeId(modeIdRaw);
  const cached = cache.get(modeId);
  if (cached) {
    return { modeId, db: cached };
  }

  const modeDir = getModeDir(modeId, dataDir);
  const dbPath = path.join(modeDir, "mecho.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  // Legacy DBs used "agent_id". Rename columns first so migration SQL that creates
  // mode_id-based indexes does not fail on existing legacy tables.
  migrateLegacyModeColumns(db, [
    "core_memory",
    "curated_memory",
    "memory_revision",
    "memory_event",
    "session_sync",
    "prepare_turn",
  ]);
  db.exec(migrationSql);
  dropLegacyPrimaryIndexes(db);

  cache.set(modeId, db);
  return { modeId, db };
}

export function getModeArchivalDb(
  modeIdRaw: string,
  dataDir: string,
): { modeId: string; db: Database.Database } {
  const modeId = sanitizeModeId(modeIdRaw);
  const cached = archivalCache.get(modeId);
  if (cached) {
    return { modeId, db: cached };
  }

  const modeDir = getModeDir(modeId, dataDir);
  const dbPath = path.join(modeDir, "archival.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  // Same legacy compatibility for archival DBs.
  migrateLegacyModeColumns(db, ["archival_memory"]);
  db.exec(archivalMigrationSql);
  dropLegacyArchivalIndexes(db);

  archivalCache.set(modeId, db);
  return { modeId, db };
}

export function checkpointWal(db: Database.Database): void {
  try {
    const rows = db.pragma("wal_checkpoint(TRUNCATE)") as Array<Record<string, unknown>>;
    const busy = Number(rows[0]?.busy ?? 0);
    if (busy > 0) {
      console.warn(`[mecho] WAL checkpoint is busy (busy=${busy})`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[mecho] WAL checkpoint failed: ${message}`);
  }
}

export function closeAllDbs(): void {
  for (const db of cache.values()) {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
  cache.clear();
  for (const db of archivalCache.values()) {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
  archivalCache.clear();
}

export function closeModeDbs(modeIdRaw: string): void {
  const modeId = sanitizeModeId(modeIdRaw);

  const primary = cache.get(modeId);
  if (primary) {
    try {
      primary.close();
    } catch {
      // ignore
    }
    cache.delete(modeId);
  }

  const archival = archivalCache.get(modeId);
  if (archival) {
    try {
      archival.close();
    } catch {
      // ignore
    }
    archivalCache.delete(modeId);
  }
}

function getModeDir(modeId: string, dataDir: string): string {
  const modeDir = path.join(dataDir, modeId);
  fs.mkdirSync(modeDir, { recursive: true });
  return modeDir;
}

export function sanitizeModeId(input: string): string {
  const trimmed = (input || "").trim().toLowerCase();
  const safe = trimmed.replace(/[^a-z0-9_-]/g, "");
  if (!safe) {
    throw new Error("modeId is required and must contain letters, numbers, '_' or '-'");
  }
  return safe;
}

function migrateLegacyModeColumns(db: Database.Database, tables: string[]): void {
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => String(column.name)));
    if (names.has("mode_id") || !names.has("agent_id")) {
      continue;
    }
    db.exec(`ALTER TABLE ${table} RENAME COLUMN agent_id TO mode_id`);
  }
}

function dropLegacyPrimaryIndexes(db: Database.Database): void {
  db.exec("DROP INDEX IF EXISTS idx_memory_event_agent_rev");
  db.exec("DROP INDEX IF EXISTS idx_session_sync_agent");
}

function dropLegacyArchivalIndexes(db: Database.Database): void {
  db.exec("DROP INDEX IF EXISTS idx_archival_memory_agent_updated");
  db.exec("DROP INDEX IF EXISTS idx_archival_memory_agent_dim");
}
