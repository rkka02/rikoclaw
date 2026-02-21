import fs from "node:fs";
import path from "node:path";
import type { Config } from "../utils/config.js";
import type { EngineType } from "./llm-runner.js";

interface EngineOverridesFile {
  overrides?: Record<string, string>;
}

export class EngineManager {
  private readonly filePath: string;
  private overrides = new Map<string, EngineType>();

  constructor(private readonly config: Config) {
    this.filePath = path.join(this.config.dataDir, "engine-overrides.json");
    this.load();
  }

  getEngine(userId: string, contextId: string): EngineType {
    const scoped = this.overrides.get(this.toScopedKey(userId, contextId));
    if (scoped) {
      return scoped;
    }

    // Back-compat: historical values were user-global ("<userId>": "codex").
    // Keep reading them until the user writes any scoped setting.
    return this.overrides.get(this.toLegacyKey(userId)) ?? "claude";
  }

  setEngine(userId: string, contextId: string, engine: EngineType | null): void {
    // If a user had a legacy global override, remove it as soon as a scoped value
    // is written so per-context behavior becomes predictable.
    this.overrides.delete(this.toLegacyKey(userId));

    const scopedKey = this.toScopedKey(userId, contextId);
    if (!engine || engine === "claude") {
      this.overrides.delete(scopedKey);
    } else {
      this.overrides.set(scopedKey, engine);
    }
    this.save();
  }

  private load(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.save();
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as EngineOverridesFile;
      const entries = Object.entries(parsed.overrides || {});
      for (const [key, value] of entries) {
        const normalizedKey = this.normalizeKey(key);
        const cleanValue = (value || "").trim() as EngineType;
        if (!normalizedKey || !cleanValue) {
          continue;
        }
        if (cleanValue === "claude" || cleanValue === "codex") {
          this.overrides.set(normalizedKey, cleanValue);
        }
      }
    } catch (error: unknown) {
      console.error(
        `[engine] failed to load overrides from ${this.filePath}, resetting:`,
        error,
      );
      this.overrides.clear();
      this.save();
    }
  }

  private save(): void {
    const payload: EngineOverridesFile = {
      overrides: Object.fromEntries(this.overrides.entries()),
    };
    fs.writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  private toScopedKey(userId: string, contextId: string): string {
    return `${userId}:${contextId}`;
  }

  private toLegacyKey(userId: string): string {
    return userId;
  }

  private normalizeKey(key: string): string | null {
    const cleanKey = key.trim();
    if (!cleanKey) {
      return null;
    }

    const parts = cleanKey.split(":");
    if (parts.length === 1 && /^\d+$/.test(cleanKey)) {
      return cleanKey;
    }

    if (parts.length !== 2) {
      return null;
    }

    const userId = parts[0]?.trim() || "";
    const contextId = parts[1]?.trim() || "";
    if (!/^\d+$/.test(userId) || !contextId) {
      return null;
    }

    return this.toScopedKey(userId, contextId);
  }
}
