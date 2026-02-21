import type Database from "better-sqlite3";
import type { CuratedMemory } from "../../domain/types.js";

export function listCurated(db: Database.Database, modeId: string): CuratedMemory[] {
  const rows = db
    .prepare(
      `SELECT mode_id, memory_id, name, description, detail, is_deleted, updated_at
       FROM curated_memory
       WHERE mode_id = ? AND is_deleted = 0
       ORDER BY memory_id ASC`,
    )
    .all(modeId) as Array<{
    mode_id: string;
    memory_id: string;
    name: string;
    description: string;
    detail: string;
    is_deleted: number;
    updated_at: number;
  }>;

  return rows.map((row) => ({
    modeId: row.mode_id,
    memoryId: row.memory_id,
    name: row.name,
    description: row.description,
    detail: row.detail,
    isDeleted: row.is_deleted === 1,
    updatedAt: Number(row.updated_at),
  }));
}

export function getCurated(
  db: Database.Database,
  modeId: string,
  memoryId: string,
): CuratedMemory | null {
  const row = db
    .prepare(
      `SELECT mode_id, memory_id, name, description, detail, is_deleted, updated_at
       FROM curated_memory
       WHERE mode_id = ? AND memory_id = ?`,
    )
    .get(modeId, memoryId) as
    | {
        mode_id: string;
        memory_id: string;
        name: string;
        description: string;
        detail: string;
        is_deleted: number;
        updated_at: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    modeId: row.mode_id,
    memoryId: row.memory_id,
    name: row.name,
    description: row.description,
    detail: row.detail,
    isDeleted: row.is_deleted === 1,
    updatedAt: Number(row.updated_at),
  };
}

export function upsertCurated(
  db: Database.Database,
  input: {
    modeId: string;
    memoryId: string;
    name: string;
    description: string;
    detail: string;
    now: number;
  },
): void {
  db.prepare(
    `INSERT INTO curated_memory (mode_id, memory_id, name, description, detail, is_deleted, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(mode_id, memory_id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       detail = excluded.detail,
       is_deleted = 0,
       updated_at = excluded.updated_at`,
  ).run(
    input.modeId,
    input.memoryId,
    input.name,
    input.description,
    input.detail,
    input.now,
  );
}

export function softDeleteCurated(
  db: Database.Database,
  input: { modeId: string; memoryId: string; now: number },
): boolean {
  const result = db
    .prepare(
      `UPDATE curated_memory
       SET is_deleted = 1, updated_at = ?
       WHERE mode_id = ? AND memory_id = ? AND is_deleted = 0`,
    )
    .run(input.now, input.modeId, input.memoryId);
  return result.changes > 0;
}
