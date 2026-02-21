import fs from "node:fs";
import path from "node:path";
import type { Config } from "../utils/config.js";
import type { EngineType } from "./llm-runner.js";

interface ModelOverridesFile {
  overrides?: Record<string, string>;
}

/** Validate and pass through keys in the current format: `engine:userId:contextId`. */
function normalizeKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) {
    return "";
  }

  const parts = trimmed.split(":");
  // Current format: "<engine>:<userId>:<contextId>" (3+ parts)
  if (
    parts.length >= 3 &&
    (parts[0] === "claude" || parts[0] === "codex") &&
    /^\d+$/.test(parts[1])
  ) {
    return trimmed;
  }

  // Legacy formats (engine:userId or bare userId) are no longer valid for
  // context-scoped overrides — skip them so they get cleaned up on next save.
  return "";
}

export class ModelManager {
  private readonly filePath: string;
  private overrides = new Map<string, string>();

  constructor(private readonly config: Config) {
    this.filePath = path.join(this.config.dataDir, "model-overrides.json");
    this.load();
  }

  getModel(userId: string, contextId: string, engine: EngineType = "claude"): string | null {
    const key = this.toKey(userId, contextId, engine);
    const model = this.overrides.get(key)?.trim();
    return model || null;
  }

  setModel(userId: string, contextId: string, engine: EngineType, model: string | null): void {
    const key = this.toKey(userId, contextId, engine);
    const cleanModel = model?.trim() || "";
    if (!cleanModel) {
      this.overrides.delete(key);
    } else {
      this.overrides.set(key, cleanModel);
    }
    this.save();
  }

  private toKey(userId: string, contextId: string, engine: EngineType): string {
    // Model override is scoped per-user per-context (thread/channel/DM).
    return `${engine}:${userId}:${contextId}`;
  }

  private load(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.save();
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as ModelOverridesFile;
      const entries = Object.entries(parsed.overrides || {});

      for (const [key, value] of entries) {
        const normalized = normalizeKey(key);
        if (!normalized) {
          continue;
        }
        const cleanValue = (value || "").trim();
        if (!cleanValue) {
          continue;
        }
        this.overrides.set(normalized, cleanValue);
      }
    } catch (error: unknown) {
      console.error(
        `[model] failed to load overrides from ${this.filePath}, resetting:`,
        error,
      );
      this.overrides.clear();
      this.save();
    }
  }

  private save(): void {
    const payload: ModelOverridesFile = {
      overrides: Object.fromEntries(this.overrides.entries()),
    };
    fs.writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}
