import fs from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import { z } from "zod";
import type { MechoConfig } from "../config.js";
import {
  closeModeDbs,
  getModeArchivalDb,
  getModeDb,
  sanitizeModeId,
} from "../persistence/db.js";
import { formatValidationError } from "./validation-error.js";

const createSchema = z.object({
  modeId: z.string().min(1),
});

const deleteSchema = z.object({
  modeId: z.string().min(1),
});

export function makeCreateModeHandler(config: MechoConfig) {
  return (req: Request, res: Response): void => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error) });
      return;
    }

    const safeModeId = sanitizeModeId(parsed.data.modeId);
    const modeDir = path.join(config.dataDir, safeModeId);
    const existed = fs.existsSync(modeDir);

    getModeDb(safeModeId, config.dataDir);
    getModeArchivalDb(safeModeId, config.dataDir);

    res.json({
      ok: true,
      modeId: safeModeId,
      created: !existed,
    });
  };
}

export function makeListModesHandler(config: MechoConfig) {
  return (_req: Request, res: Response): void => {
    try {
      if (!fs.existsSync(config.dataDir)) {
        res.json({ ok: true, modes: [] });
        return;
      }
      const entries = fs.readdirSync(config.dataDir, { withFileTypes: true });
      const modes: string[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Only include dirs that contain a mecho.db (actual mode storage)
        const dbPath = path.join(config.dataDir, entry.name, "mecho.db");
        if (fs.existsSync(dbPath)) {
          modes.push(entry.name);
        }
      }
      modes.sort();
      res.json({ ok: true, modes });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `failed to list modes: ${message}` });
    }
  };
}

export function makeDeleteModeHandler(config: MechoConfig) {
  return (req: Request, res: Response): void => {
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatValidationError(parsed.error) });
      return;
    }

    const safeModeId = sanitizeModeId(parsed.data.modeId);
    const modeDir = path.join(config.dataDir, safeModeId);
    if (!fs.existsSync(modeDir)) {
      res.status(404).json({ error: "mode not found" });
      return;
    }

    closeModeDbs(safeModeId);
    fs.rmSync(modeDir, { recursive: true, force: true });

    res.json({
      ok: true,
      modeId: safeModeId,
      deleted: true,
    });
  };
}
