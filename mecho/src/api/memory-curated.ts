import type { Request, Response } from "express";
import { z } from "zod";
import type { MechoConfig } from "../config.js";
import { getModeDb } from "../persistence/db.js";
import {
  listCurated,
  getCurated,
  upsertCurated,
  softDeleteCurated,
} from "../persistence/repos/curated-repo.js";
import { bumpRevision } from "../persistence/repos/revision-repo.js";
import { insertMemoryEvent } from "../persistence/repos/event-repo.js";
import { formatValidationError } from "./validation-error.js";

const listSchema = z.object({ modeId: z.string().min(1) });
const getDetailSchema = z.object({
  modeId: z.string().min(1),
  memoryId: z.string().min(1),
});
const putSchema = z.object({
  modeId: z.string().min(1),
  memoryId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).max(500),
  detail: z.string().min(1).max(3000),
});
const deleteSchema = z.object({
  modeId: z.string().min(1),
  memoryId: z.string().min(1),
});

export function makeListCuratedHandler(config: MechoConfig) {
  return (req: Request, res: Response): void => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error) });
      return;
    }

    const { db, modeId } = getModeDb(parsed.data.modeId, config.dataDir);
    const curated = listCurated(db, modeId).map((item) => ({
      memoryId: item.memoryId,
      name: item.name,
      description: item.description,
      updatedAt: item.updatedAt,
    }));
    res.json({ curated });
  };
}

export function makeGetCuratedDetailHandler(config: MechoConfig) {
  return (req: Request, res: Response): void => {
    const parsed = getDetailSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error) });
      return;
    }

    const { db, modeId } = getModeDb(parsed.data.modeId, config.dataDir);
    const memory = getCurated(db, modeId, parsed.data.memoryId);
    if (!memory || memory.isDeleted) {
      res.status(404).json({ error: "curated memory not found" });
      return;
    }

    res.json({
      memory: {
        memoryId: memory.memoryId,
        name: memory.name,
        description: memory.description,
        detail: memory.detail,
        updatedAt: memory.updatedAt,
      },
    });
  };
}

export function makePutCuratedHandler(config: MechoConfig) {
  return (req: Request, res: Response): void => {
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error) });
      return;
    }

    const now = Date.now();
    const { db, modeId } = getModeDb(parsed.data.modeId, config.dataDir);

    const tx = db.transaction(() => {
      upsertCurated(db, {
        modeId,
        memoryId: parsed.data.memoryId,
        name: parsed.data.name,
        description: parsed.data.description,
        detail: parsed.data.detail,
        now,
      });

      const rev = bumpRevision(db, modeId, now);
      insertMemoryEvent(db, {
        modeId,
        rev,
        eventType: "curated_upsert",
        memoryId: parsed.data.memoryId,
        payloadJson: JSON.stringify({
          memoryId: parsed.data.memoryId,
          name: parsed.data.name,
          description: parsed.data.description,
        }),
        now,
      });
      return rev;
    });

    const revision = tx();
    res.json({ ok: true, revision });
  };
}

export function makeDeleteCuratedHandler(config: MechoConfig) {
  return (req: Request, res: Response): void => {
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error) });
      return;
    }

    const now = Date.now();
    const { db, modeId } = getModeDb(parsed.data.modeId, config.dataDir);

    const tx = db.transaction(() => {
      const deleted = softDeleteCurated(db, {
        modeId,
        memoryId: parsed.data.memoryId,
        now,
      });
      if (!deleted) {
        return { deleted: false, revision: null as number | null };
      }

      const rev = bumpRevision(db, modeId, now);
      insertMemoryEvent(db, {
        modeId,
        rev,
        eventType: "curated_delete",
        memoryId: parsed.data.memoryId,
        payloadJson: JSON.stringify({ memoryId: parsed.data.memoryId }),
        now,
      });

      return { deleted: true, revision: rev };
    });

    const result = tx();
    if (!result.deleted) {
      res.status(404).json({ error: "curated memory not found" });
      return;
    }

    res.json({ ok: true, revision: result.revision });
  };
}
