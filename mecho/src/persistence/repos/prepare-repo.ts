import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { PrepareMode } from "../../domain/types.js";

export interface PrepareTurnRow {
  prepareId: string;
  sessionKey: string;
  modeId: string;
  fromRevision: number;
  toRevision: number;
  mode: PrepareMode;
  createdAt: number;
  ackedAt: number | null;
  ackStatus: "success" | "failed" | null;
}

export function createPrepareTurn(
  db: Database.Database,
  input: {
    sessionKey: string;
    modeId: string;
    fromRevision: number;
    toRevision: number;
    mode: PrepareMode;
    now: number;
  },
): string {
  const prepareId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO prepare_turn
      (prepare_id, session_key, mode_id, from_revision, to_revision, mode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    prepareId,
    input.sessionKey,
    input.modeId,
    input.fromRevision,
    input.toRevision,
    input.mode,
    input.now,
  );
  return prepareId;
}

export function getPrepareTurn(db: Database.Database, prepareId: string): PrepareTurnRow | null {
  const row = db
    .prepare(
      `SELECT prepare_id, session_key, mode_id, from_revision, to_revision, mode, created_at, acked_at, ack_status
       FROM prepare_turn
       WHERE prepare_id = ?`,
    )
    .get(prepareId) as
    | {
        prepare_id: string;
        session_key: string;
        mode_id: string;
        from_revision: number;
        to_revision: number;
        mode: PrepareMode;
        created_at: number;
        acked_at: number | null;
        ack_status: "success" | "failed" | null;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    prepareId: row.prepare_id,
    sessionKey: row.session_key,
    modeId: row.mode_id,
    fromRevision: Number(row.from_revision),
    toRevision: Number(row.to_revision),
    mode: row.mode,
    createdAt: Number(row.created_at),
    ackedAt: row.acked_at == null ? null : Number(row.acked_at),
    ackStatus: row.ack_status,
  };
}

export function ackPrepareTurn(
  db: Database.Database,
  input: { prepareId: string; status: "success" | "failed"; now: number },
): boolean {
  const result = db
    .prepare(
      `UPDATE prepare_turn
       SET acked_at = ?, ack_status = ?
       WHERE prepare_id = ? AND acked_at IS NULL`,
    )
    .run(input.now, input.status, input.prepareId);
  return result.changes > 0;
}
