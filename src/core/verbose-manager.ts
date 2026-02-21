import fs from "node:fs";
import path from "node:path";
import type { Config } from "../utils/config.js";

interface VerboseOverridesFile {
  overrides?: Record<string, boolean>;
}

export class VerboseManager {
  private readonly filePath: string;
  private overrides = new Map<string, boolean>();

  constructor(private readonly config: Config) {
    this.filePath = path.join(this.config.dataDir, "verbose-overrides.json");
    this.load();
  }

  /** Returns the explicit override for this user+context, if any. */
  getOverride(userId: string, contextId: string): boolean | null {
    const key = this.toKey(userId, contextId);
    const value = this.overrides.get(key);
    return typeof value === "boolean" ? value : null;
  }

  /** Effective value: override if present, otherwise falls back to env default (ENABLE_LIVE_UPDATES). */
  isEnabled(userId: string, contextId: string): boolean {
    const override = this.getOverride(userId, contextId);
    return override ?? this.config.enableLiveUpdates;
  }

  /** Set override. Use null to reset to default. */
  setOverride(userId: string, contextId: string, enabled: boolean | null): void {
    const key = this.toKey(userId, contextId);
    if (enabled === null) {
      this.overrides.delete(key);
    } else {
      this.overrides.set(key, Boolean(enabled));
    }
    this.save();
  }

  private toKey(userId: string, contextId: string): string {
    return `${userId}:${contextId}`;
  }

  private load(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.save();
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as VerboseOverridesFile;
      const overrides = parsed.overrides || {};
      for (const [key, value] of Object.entries(overrides)) {
        if (!key) {
          continue;
        }
        if (typeof value === "boolean") {
          this.overrides.set(key, value);
        }
      }
    } catch (error: unknown) {
      console.error(
        `[verbose] failed to load overrides from ${this.filePath}, resetting:`,
        error,
      );
      this.overrides.clear();
      this.save();
    }
  }

  private save(): void {
    const payload: VerboseOverridesFile = {
      overrides: Object.fromEntries(this.overrides.entries()),
    };
    fs.writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

