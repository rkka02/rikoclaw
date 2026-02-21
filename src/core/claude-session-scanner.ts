import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionManager } from "./session-manager.js";

export interface ClaudeSessionEntry {
  sessionId: string;
  source: "cli" | "discord";
  lastUsedAt: number;
  messageCount: number;
  contextId: string | null;
  userId: string | null;
}

export class ClaudeSessionScanner {
  private readonly projectsDir: string;
  private readonly sessions: SessionManager;

  constructor(sessions: SessionManager) {
    this.sessions = sessions;
    this.projectsDir = path.join(os.homedir(), ".claude", "projects");
  }

  scan(): ClaudeSessionEntry[] {
    const results: ClaudeSessionEntry[] = [];

    // 1. Discord bot sessions from SessionManager
    try {
      const botSessions = this.sessions.listSessions("claude");
      for (const s of botSessions) {
        results.push({
          sessionId: s.sessionId,
          source: "discord",
          lastUsedAt: s.lastUsedAt,
          messageCount: s.messageCount,
          contextId: s.contextId,
          userId: s.userId,
        });
      }
    } catch (error: unknown) {
      console.warn("[session-scanner] failed to read bot sessions:", error);
    }

    // 2. CLI sessions from ~/.claude/projects/
    try {
      if (fs.existsSync(this.projectsDir)) {
        const encodedPaths = fs.readdirSync(this.projectsDir);
        for (const encodedPath of encodedPaths) {
          const projectDir = path.join(this.projectsDir, encodedPath);
          const stat = fs.statSync(projectDir);
          if (!stat.isDirectory()) continue;

          const files = fs.readdirSync(projectDir);
          for (const file of files) {
            if (!file.endsWith(".jsonl")) continue;

            const sessionId = file.replace(/\.jsonl$/, "");
            // Skip if already tracked as discord session
            if (results.some((r) => r.sessionId === sessionId)) continue;

            const filePath = path.join(projectDir, file);
            const fileStat = fs.statSync(filePath);

            // Count lines as rough message count
            let lineCount = 0;
            try {
              const content = fs.readFileSync(filePath, "utf-8");
              lineCount = content.split("\n").filter((l) => l.trim()).length;
            } catch {
              // ignore read errors
            }

            results.push({
              sessionId,
              source: "cli",
              lastUsedAt: fileStat.mtimeMs,
              messageCount: lineCount,
              contextId: decodeProjectPath(encodedPath),
              userId: null,
            });
          }
        }
      }
    } catch (error: unknown) {
      console.warn("[session-scanner] failed to scan CLI sessions:", error);
    }

    // Sort by most recently used
    results.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    return results;
  }
}

function decodeProjectPath(encoded: string): string {
  // Claude CLI encodes paths: / → - , leading - stripped
  // e.g. "-Users-mw-Desktop-zerotwo_claw" → "<PROJECT_ROOT>"
  return "/" + encoded.replace(/^-/, "").replace(/-/g, "/");
}
