import type Database from "better-sqlite3";

export function getLastAckedRevision(db: Database.Database, sessionKey: string): number {
  const row = db
    .prepare(`SELECT last_acked_rev FROM session_sync WHERE session_key = ?`)
    .get(sessionKey) as { last_acked_rev: number } | undefined;
  return row ? Number(row.last_acked_rev) : 0;
}

export function upsertLastAckedRevision(
  db: Database.Database,
  input: { sessionKey: string; modeId: string; revision: number; now: number },
): void {
  db.prepare(
    `INSERT INTO session_sync (session_key, mode_id, last_acked_rev, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_key) DO UPDATE SET
       mode_id = excluded.mode_id,
       last_acked_rev = excluded.last_acked_rev,
       updated_at = excluded.updated_at`,
  ).run(input.sessionKey, input.modeId, input.revision, input.now);
}
