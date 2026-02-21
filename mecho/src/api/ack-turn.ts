import type { Request, Response } from "express";
import { z } from "zod";
import { checkpointWal, getModeDb, sanitizeModeId } from "../persistence/db.js";
import { ackPrepareTurn, getPrepareTurn } from "../persistence/repos/prepare-repo.js";
import { upsertLastAckedRevision } from "../persistence/repos/session-sync-repo.js";
import type { MechoConfig } from "../config.js";

const schema = z.object({
  modeId: z.string().min(1),
  prepareId: z.string().min(1),
  sessionKey: z.string().min(1),
  status: z.enum(["success", "failed"]),
});

export function makeAckTurnHandler(config: MechoConfig) {
  return (req: Request, res: Response): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "invalid request" });
      return;
    }

    const now = Date.now();
    const { modeId, prepareId, sessionKey, status } = parsed.data;
    const safeModeId = sanitizeModeId(modeId);
    const sessionModeId = (sessionKey.split(":", 1)[0] || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");
    if (sessionModeId && sessionModeId !== safeModeId) {
      res.status(409).json({ error: "mode id mismatch" });
      return;
    }
    const { db } = getModeDb(safeModeId, config.dataDir);

    const row = getPrepareTurn(db, prepareId);
    if (!row) {
      res.status(404).json({ error: "prepare turn not found" });
      return;
    }
    if (row.sessionKey !== sessionKey) {
      res.status(409).json({ error: "session key mismatch" });
      return;
    }
    if (row.modeId !== safeModeId) {
      res.status(409).json({ error: "mode id mismatch" });
      return;
    }

    const acked = ackPrepareTurn(db, { prepareId, status, now });
    if (!acked) {
      checkpointWal(db);
      res.json({ ok: true, idempotent: true });
      return;
    }

    if (status === "success") {
      upsertLastAckedRevision(db, {
        sessionKey,
        modeId: row.modeId,
        revision: row.toRevision,
        now,
      });
    }

    checkpointWal(db);
    res.json({ ok: true });
  };
}
