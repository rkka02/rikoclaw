import type { Request, Response } from "express";
import { z } from "zod";
import type { MechoConfig } from "../config.js";
import { getModeDb } from "../persistence/db.js";
import { getCore, upsertCore } from "../persistence/repos/core-repo.js";
import { bumpRevision } from "../persistence/repos/revision-repo.js";
import { insertMemoryEvent } from "../persistence/repos/event-repo.js";
import { formatValidationError } from "./validation-error.js";

const getSchema = z.object({ modeId: z.string().min(1) });
const putSchema = z.object({
  modeId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).max(1000),
  detail: z.string().min(1).max(3000),
});

export function makeGetCoreHandler(config: MechoConfig) {
  return (req: Request, res: Response): void => {
    const parsed = getSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error) });
      return;
    }

    const { db, modeId } = getModeDb(parsed.data.modeId, config.dataDir);
    const core = getCore(db, modeId);
    res.json({ core });
  };
}

export function makePutCoreHandler(config: MechoConfig) {
  return (req: Request, res: Response): void => {
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error) });
      return;
    }

    const now = Date.now();
    const { db, modeId } = getModeDb(parsed.data.modeId, config.dataDir);

    const tx = db.transaction(() => {
      upsertCore(db, {
        modeId,
        name: parsed.data.name,
        description: parsed.data.description,
        detail: parsed.data.detail,
        now,
      });

      const rev = bumpRevision(db, modeId, now);
      insertMemoryEvent(db, {
        modeId,
        rev,
        eventType: "core_upsert",
        memoryId: null,
        payloadJson: JSON.stringify({ name: parsed.data.name, description: parsed.data.description }),
        now,
      });
      return rev;
    });

    const revision = tx();
    res.json({ ok: true, revision });
  };
}
