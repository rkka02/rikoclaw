import fs from "node:fs";
import path from "node:path";
import type { Config } from "../utils/config.js";

interface MechoModeOverridesFile {
  overrides?: Record<string, string>;
}

export class MechoModeManager {
  private readonly filePath: string;
  private overrides = new Map<string, string>();

  constructor(private readonly config: Config) {
    this.filePath = path.join(this.config.dataDir, "mecho-mode-overrides.json");
    this.load();
  }

  getModeId(userId: string, contextId: string): string | null {
    const key = this.toKey(userId, contextId);
    if (!key) {
      return null;
    }
    const value = this.overrides.get(key)?.trim();
    return value || null;
  }

  setModeId(userId: string, contextId: string, modeId: string | null): void {
    const key = this.toKey(userId, contextId);
    if (!key) {
      return;
    }
    const clean = (modeId || "").trim();
    if (!clean) {
      this.overrides.delete(key);
    } else {
      this.overrides.set(key, clean);
    }
    this.save();
  }

  private toKey(_userId: string, contextId: string): string {
    return normalizeContextKey(contextId) || "";
  }

  private load(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.save();
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as MechoModeOverridesFile;
      const entries = Object.entries(parsed.overrides || {});
      let migratedLegacyCount = 0;
      let discardedInvalidCount = 0;
      let hasChanged = false;
      for (const [key, value] of entries) {
        const cleanKey = normalizeContextKey(key);
        const cleanValue = (value || "").trim();
        if (!cleanKey) {
          discardedInvalidCount += 1;
          hasChanged = true;
          continue;
        }
        if (!cleanValue) {
          hasChanged = true;
          continue;
        }
        if (cleanKey !== key.trim()) {
          migratedLegacyCount += 1;
          hasChanged = true;
        }
        this.overrides.set(cleanKey, cleanValue);
      }

      if (migratedLegacyCount > 0 || discardedInvalidCount > 0) {
        console.log(
          `[mecho-mode] migrated legacy bindings=${migratedLegacyCount} discarded_invalid=${discardedInvalidCount}`,
        );
      }
      if (hasChanged) {
        this.save();
      }
    } catch (error: unknown) {
      console.error(
        `[mecho-mode] failed to load overrides from ${this.filePath}, resetting:`,
        error,
      );
      this.overrides.clear();
      this.save();
    }
  }

  private save(): void {
    const payload: MechoModeOverridesFile = {
      overrides: Object.fromEntries(this.overrides.entries()),
    };
    fs.writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

function normalizeContextKey(value: string): string | null {
  const key = value.trim();
  if (!key) {
    return null;
  }
  if (isContextId(key)) {
    return key;
  }

  // Legacy key format: "<userId>:<contextId>"
  const separator = key.indexOf(":");
  if (separator <= 0 || separator >= key.length - 1) {
    return null;
  }
  const maybeContext = key.slice(separator + 1).trim();
  if (!isContextId(maybeContext)) {
    return null;
  }
  return maybeContext;
}

function isContextId(value: string): boolean {
  return /^(ch_|th_|dm_).+/.test(value);
}
