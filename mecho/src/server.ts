import express from "express";
import { loadConfig } from "./config.js";
import { registerRoutes } from "./api/routes.js";
import { closeAllDbs } from "./persistence/db.js";

const config = loadConfig();
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(
      `[mecho] ${req.method} ${req.path} status=${res.statusCode} durationMs=${Date.now() - startedAt}`,
    );
  });
  next();
});

registerRoutes(app, config);

const server = app.listen(config.port, config.host, () => {
  console.log(`[mecho] listening on http://${config.host}:${config.port}`);
});

const shutdown = (): void => {
  server.close(() => {
    closeAllDbs();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
