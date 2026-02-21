import type Database from "better-sqlite3";
import type { MemoryEvent } from "../../domain/types.js";

export function insertMemoryEvent(
  db: Database.Database,
  input: {
    modeId: string;
    rev: number;
    eventType: "core_upsert" | "curated_upsert" | "curated_delete";
    memoryId: string | null;
    payloadJson: string;
    now: number;
  },
): void {
  db.prepare(
    `INSERT INTO memory_event (mode_id, rev, event_type, memory_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(input.modeId, input.rev, input.eventType, input.memoryId, input.payloadJson, input.now);
}

export function listMemoryEventsInRange(
  db: Database.Database,
  input: { modeId: string; fromRevisionExclusive: number; toRevisionInclusive: number },
): MemoryEvent[] {
  const rows = db
    .prepare(
      `SELECT id, mode_id, rev, event_type, memory_id, payload_json, created_at
       FROM memory_event
       WHERE mode_id = ?
         AND rev > ?
         AND rev <= ?
       ORDER BY rev ASC, id ASC`,
    )
    .all(input.modeId, input.fromRevisionExclusive, input.toRevisionInclusive) as Array<{
    id: number;
    mode_id: string;
    rev: number;
    event_type: "core_upsert" | "curated_upsert" | "curated_delete";
    memory_id: string | null;
    payload_json: string;
    created_at: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    modeId: row.mode_id,
    rev: Number(row.rev),
    eventType: row.event_type,
    memoryId: row.memory_id,
    payloadJson: row.payload_json,
    createdAt: Number(row.created_at),
  }));
}
