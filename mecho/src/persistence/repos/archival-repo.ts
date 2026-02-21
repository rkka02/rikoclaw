import crypto from "node:crypto";
import type Database from "better-sqlite3";

export interface ArchivalMemoryRow {
  memoryId: string;
  modeId: string;
  name: string;
  description: string;
  detail: string;
  embedding: number[];
  embeddingDim: number;
  embeddingNorm: number;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export function upsertArchivalMemory(
  db: Database.Database,
  input: {
    modeId: string;
    memoryId?: string | null;
    name: string;
    description: string;
    detail: string;
    embedding: number[];
    metadata: Record<string, unknown>;
    now: number;
  },
): { memoryId: string; created: boolean } {
  const memoryId = (input.memoryId || "").trim() || crypto.randomUUID();
  const existing = db
    .prepare(
      `SELECT memory_id
       FROM archival_memory
       WHERE memory_id = ? AND mode_id = ?`,
    )
    .get(memoryId, input.modeId) as { memory_id: string } | undefined;

  const embeddingNorm = vectorNorm(input.embedding);
  db.prepare(
    `INSERT INTO archival_memory
      (memory_id, mode_id, name, description, detail, embedding_json, embedding_dim, embedding_norm, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(memory_id) DO UPDATE SET
       mode_id = excluded.mode_id,
       name = excluded.name,
       description = excluded.description,
       detail = excluded.detail,
       embedding_json = excluded.embedding_json,
       embedding_dim = excluded.embedding_dim,
       embedding_norm = excluded.embedding_norm,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at`,
  ).run(
    memoryId,
    input.modeId,
    input.name,
    input.description,
    input.detail,
    JSON.stringify(input.embedding),
    input.embedding.length,
    embeddingNorm,
    JSON.stringify(input.metadata),
    input.now,
    input.now,
  );

  return { memoryId, created: !existing };
}

export function listArchivalByDimension(
  db: Database.Database,
  input: { modeId: string; dimension: number; limit: number },
): ArchivalMemoryRow[] {
  const rows = db
    .prepare(
      `SELECT memory_id, mode_id, name, description, detail, embedding_json, embedding_dim, embedding_norm, metadata_json, created_at, updated_at
       FROM archival_memory
       WHERE mode_id = ? AND embedding_dim = ?
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(input.modeId, input.dimension, input.limit) as Array<{
    memory_id: string;
    mode_id: string;
    name: string;
    description: string;
    detail: string;
    embedding_json: string;
    embedding_dim: number;
    embedding_norm: number;
    metadata_json: string;
    created_at: number;
    updated_at: number;
  }>;

  return rows.map((row) => ({
    memoryId: row.memory_id,
    modeId: row.mode_id,
    name: row.name,
    description: row.description,
    detail: row.detail,
    embedding: parseVector(row.embedding_json),
    embeddingDim: Number(row.embedding_dim),
    embeddingNorm: Number(row.embedding_norm),
    metadata: parseMetadata(row.metadata_json),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
}

function parseVector(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  } catch {
    return [];
  }
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function deleteArchivalMemory(
  db: Database.Database,
  input: { modeId: string; memoryId: string },
): boolean {
  const result = db
    .prepare(
      `DELETE FROM archival_memory
       WHERE memory_id = ? AND mode_id = ?`,
    )
    .run(input.memoryId, input.modeId);
  return result.changes > 0;
}

function vectorNorm(values: number[]): number {
  let sum = 0;
  for (const value of values) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}
