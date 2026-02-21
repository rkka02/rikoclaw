import type Database from "better-sqlite3";
import type { CoreMemory } from "../../domain/types.js";

export function getCore(db: Database.Database, modeId: string): CoreMemory | null {
  const row = db
    .prepare(
      `SELECT mode_id, name, description, detail, updated_at
       FROM core_memory
       WHERE mode_id = ?`,
    )
    .get(modeId) as
    | {
        mode_id: string;
        name: string;
        description: string;
        detail: string;
        updated_at: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    modeId: row.mode_id,
    name: row.name,
    description: row.description,
    detail: row.detail,
    updatedAt: Number(row.updated_at),
  };
}

export function upsertCore(
  db: Database.Database,
  input: { modeId: string; name: string; description: string; detail: string; now: number },
): void {
  db.prepare(
    `INSERT INTO core_memory (mode_id, name, description, detail, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(mode_id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       detail = excluded.detail,
       updated_at = excluded.updated_at`,
  ).run(input.modeId, input.name, input.description, input.detail, input.now);
}
