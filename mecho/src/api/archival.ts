import type { Request, Response } from "express";
import { z } from "zod";
import type { MechoConfig } from "../config.js";
import { embedTextWithOllama } from "../integrations/ollama-embeddings.js";
import { getModeArchivalDb } from "../persistence/db.js";
import {
  deleteArchivalMemory,
  listArchivalByDimension,
  upsertArchivalMemory,
} from "../persistence/repos/archival-repo.js";
import { formatValidationError } from "./validation-error.js";

const upsertSchema = z.object({
  modeId: z.string().min(1),
  memoryId: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  detail: z.string().min(1).max(12000),
  metadata: z.record(z.unknown()).optional(),
});

const searchSchema = z.object({
  modeId: z.string().min(1),
  query: z.string().min(1).max(12000),
  topK: z.number().int().min(1).max(50).optional(),
  candidateLimit: z.number().int().min(1).max(5000).optional(),
  minScore: z.number().min(-1).max(1).optional(),
  includeDetail: z.boolean().optional(),
});

export function makeArchivalUpsertHandler(config: MechoConfig) {
  return (req: Request, res: Response): void => {
    void (async () => {
      const parsed = upsertSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error) });
        return;
      }

      const now = Date.now();
      const { db, modeId } = getModeArchivalDb(parsed.data.modeId, config.dataDir);
      const embeddingText = buildEmbeddingText({
        name: parsed.data.name,
        description: parsed.data.description,
        detail: parsed.data.detail,
      });
      const embedding = await embedTextWithOllama(config, embeddingText);
      if (embedding.length === 0) {
        res.status(502).json({ error: "embedding_failed", message: "empty embedding vector" });
        return;
      }

      const tx = db.transaction(() => {
        return upsertArchivalMemory(db, {
          modeId,
          memoryId: parsed.data.memoryId,
          name: parsed.data.name,
          description: parsed.data.description,
          detail: parsed.data.detail,
          embedding,
          metadata: parsed.data.metadata || {},
          now,
        });
      });
      const result = tx();

      res.json({
        ok: true,
        memoryId: result.memoryId,
        created: result.created,
        embeddingDim: embedding.length,
        model: config.ollamaEmbedModel,
      });
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      res.status(502).json({ error: "archival_upsert_failed", message });
    });
  };
}

export function makeArchivalSearchHandler(config: MechoConfig) {
  return (req: Request, res: Response): void => {
    void (async () => {
      const parsed = searchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: formatValidationError(parsed.error) });
        return;
      }

      const topK = parsed.data.topK ?? 8;
      const candidateLimit = Math.max(topK, parsed.data.candidateLimit ?? 600);
      const includeDetail = parsed.data.includeDetail ?? false;
      const minScore = parsed.data.minScore;

      const queryEmbedding = await embedTextWithOllama(config, parsed.data.query);
      if (queryEmbedding.length === 0) {
        res.status(502).json({ error: "embedding_failed", message: "empty query embedding" });
        return;
      }
      const queryNorm = vectorNorm(queryEmbedding);
      if (queryNorm <= 0) {
        res.status(502).json({ error: "embedding_failed", message: "invalid query embedding norm" });
        return;
      }

      const { db, modeId } = getModeArchivalDb(parsed.data.modeId, config.dataDir);
      const candidates = listArchivalByDimension(db, {
        modeId,
        dimension: queryEmbedding.length,
        limit: candidateLimit,
      });

      const scored = candidates
        .map((row) => ({
          row,
          score: cosineSimilarity(queryEmbedding, queryNorm, row.embedding, row.embeddingNorm),
        }))
        .filter((item) => Number.isFinite(item.score))
        .filter((item) => (minScore == null ? true : item.score >= minScore))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      res.json({
        matches: scored.map(({ row, score }) => ({
          memoryId: row.memoryId,
          name: row.name,
          description: row.description,
          detail: includeDetail ? row.detail : undefined,
          metadata: row.metadata,
          score,
          updatedAt: row.updatedAt,
        })),
        meta: {
          model: config.ollamaEmbedModel,
          queryEmbeddingDim: queryEmbedding.length,
          candidatesScanned: candidates.length,
          topK,
        },
      });
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      res.status(502).json({ error: "archival_search_failed", message });
    });
  };
}

const deleteSchema = z.object({
  modeId: z.string().min(1),
  memoryId: z.string().min(1),
});

export function makeArchivalDeleteHandler(config: MechoConfig) {
  return (req: Request, res: Response): void => {
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error) });
      return;
    }

    const { db, modeId } = getModeArchivalDb(parsed.data.modeId, config.dataDir);
    const deleted = deleteArchivalMemory(db, {
      modeId,
      memoryId: parsed.data.memoryId,
    });

    if (!deleted) {
      res.status(404).json({ error: "archival memory not found" });
      return;
    }

    res.json({ ok: true, memoryId: parsed.data.memoryId });
  };
}

function buildEmbeddingText(input: {
  name: string;
  description: string;
  detail: string;
}): string {
  return [
    `name: ${input.name.trim()}`,
    `description: ${input.description.trim()}`,
    `detail: ${input.detail.trim()}`,
  ].join("\n");
}

function cosineSimilarity(
  left: number[],
  leftNorm: number,
  right: number[],
  rightNorm: number,
): number {
  if (leftNorm <= 0 || rightNorm <= 0 || left.length !== right.length) {
    return Number.NEGATIVE_INFINITY;
  }

  let dot = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i]! * right[i]!;
  }
  return dot / (leftNorm * rightNorm);
}

function vectorNorm(values: number[]): number {
  let sum = 0;
  for (const value of values) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}
