import type { Request, Response } from "express";
import { z } from "zod";
import { getModeDb } from "../persistence/db.js";
import { getCurrentRevision } from "../persistence/repos/revision-repo.js";
import { getLastAckedRevision } from "../persistence/repos/session-sync-repo.js";
import { createPrepareTurn } from "../persistence/repos/prepare-repo.js";
import { compilePreparePayload } from "../domain/delta-compiler.js";
import type { MechoConfig } from "../config.js";

const schema = z.object({
  modeId: z.string().min(1),
  sessionKey: z.string().min(1),
  engine: z.enum(["claude", "codex"]),
  forceFull: z.boolean().optional(),
});

export function makePrepareTurnHandler(config: MechoConfig) {
  return (req: Request, res: Response): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "invalid request" });
      return;
    }

    const now = Date.now();
    const { modeId, sessionKey } = parsed.data;

    const { modeId: safeModeId, db } = getModeDb(modeId, config.dataDir);
    const lastAcked = getLastAckedRevision(db, sessionKey);
    const currentRevision = getCurrentRevision(db, safeModeId);

    const prepareId = createPrepareTurn(db, {
      sessionKey,
      modeId: safeModeId,
      fromRevision: lastAcked,
      toRevision: currentRevision,
      mode: currentRevision > lastAcked ? (lastAcked <= 0 ? "full" : "delta") : "none",
      now,
    });

    const result = compilePreparePayload({
      db,
      modeId: safeModeId,
      fromRevision: lastAcked,
      toRevision: currentRevision,
      prepareId,
    });

    res.json(result);
  };
}
