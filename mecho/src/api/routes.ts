import type { Express } from "express";
import { makePrepareTurnHandler } from "./prepare-turn.js";
import { makeAckTurnHandler } from "./ack-turn.js";
import {
  makeGetCoreHandler,
  makePutCoreHandler,
} from "./memory-core.js";
import {
  makeDeleteCuratedHandler,
  makeGetCuratedDetailHandler,
  makeListCuratedHandler,
  makePutCuratedHandler,
} from "./memory-curated.js";
import { makeArchivalDeleteHandler, makeArchivalSearchHandler, makeArchivalUpsertHandler } from "./archival.js";
import { makeCreateModeHandler, makeDeleteModeHandler, makeListModesHandler } from "./mode.js";
import type { MechoConfig } from "../config.js";

export function registerRoutes(app: Express, config: MechoConfig): void {
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "mecho" });
  });

  app.post("/v1/turn/prepare", makePrepareTurnHandler(config));
  app.post("/v1/turn/ack", makeAckTurnHandler(config));

  app.get("/v1/memory/core", makeGetCoreHandler(config));
  app.put("/v1/memory/core", makePutCoreHandler(config));

  app.get("/v1/memory/curated", makeListCuratedHandler(config));
  app.get("/v1/memory/curated/detail", makeGetCuratedDetailHandler(config));
  app.put("/v1/memory/curated", makePutCuratedHandler(config));
  app.delete("/v1/memory/curated", makeDeleteCuratedHandler(config));

  app.post("/v1/archival/search", makeArchivalSearchHandler(config));
  app.post("/v1/archival/upsert", makeArchivalUpsertHandler(config));
  app.delete("/v1/archival", makeArchivalDeleteHandler(config));

  app.get("/v1/mode/list", makeListModesHandler(config));
  app.post("/v1/mode/create", makeCreateModeHandler(config));
  app.post("/v1/mode/delete", makeDeleteModeHandler(config));
}
