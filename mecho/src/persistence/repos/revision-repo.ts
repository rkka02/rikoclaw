import type Database from "better-sqlite3";

export function getCurrentRevision(db: Database.Database, modeId: string): number {
  const row = db
    .prepare(`SELECT current_rev FROM memory_revision WHERE mode_id = ?`)
    .get(modeId) as { current_rev: number } | undefined;
  return row ? Number(row.current_rev) : 0;
}

export function bumpRevision(db: Database.Database, modeId: string, now: number): number {
  db.prepare(
    `INSERT INTO memory_revision (mode_id, current_rev, updated_at)
     VALUES (?, 0, ?)
     ON CONFLICT(mode_id) DO NOTHING`,
  ).run(modeId, now);

  db.prepare(
    `UPDATE memory_revision
     SET current_rev = current_rev + 1, updated_at = ?
     WHERE mode_id = ?`,
  ).run(now, modeId);

  return getCurrentRevision(db, modeId);
}
