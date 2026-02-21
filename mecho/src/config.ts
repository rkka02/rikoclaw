import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MechoConfig {
  host: string;
  port: number;
  dataDir: string;
  ollamaUrl: string;
  ollamaEmbedModel: string;
  ollamaTimeoutMs: number;
}

export function loadConfig(): MechoConfig {
  const host = process.env.MECHO_HOST?.trim() || "127.0.0.1";
  const port = parsePositiveInt(process.env.MECHO_PORT, 3100);
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const explicitDataDir = process.env.MECHO_DATA_DIR?.trim();
  const defaultModesDir = path.join(projectRoot, "data", "modes");
  const legacyAgentsDir = path.join(projectRoot, "data", "agents");
  const dataDir = explicitDataDir
    || (fs.existsSync(defaultModesDir) || !fs.existsSync(legacyAgentsDir)
      ? defaultModesDir
      : legacyAgentsDir);
  const ollamaUrl = process.env.OLLAMA_URL?.trim() || "http://127.0.0.1:11434";
  const ollamaEmbedModel = process.env.OLLAMA_EMBED_MODEL?.trim() || "qwen3-embedding:4b";
  const ollamaTimeoutMs = parsePositiveInt(process.env.OLLAMA_TIMEOUT_MS, 15000);
  return { host, port, dataDir, ollamaUrl, ollamaEmbedModel, ollamaTimeoutMs };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}
