import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { EngineType } from "./llm-runner.js";

export interface SessionInfo {
  userId: string;
  contextId: string;
  engine: EngineType;
  sessionId: string;
  createdAt: number;
  lastUsedAt: number;
  messageCount: number;
}

interface SessionRow {
  user_id: string;
  context_id: string;
  engine: string;
  session_id: string;
  created_at: number;
  last_used_at: number;
  message_count: number;
}

export class SessionManager {
  private readonly db: Database.Database;
  private readonly claimMessageStmt: Database.Statement;
  private readonly pruneClaimedMessagesStmt: Database.Statement;

  constructor(dbPath: string) {
    const dirPath = path.dirname(dbPath);
    fs.mkdirSync(dirPath, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 3000");
    this.init();
    this.claimMessageStmt = this.db.prepare(`
      INSERT OR IGNORE INTO processed_message_events (message_id, created_at)
      VALUES (?, ?)
    `);
    this.pruneClaimedMessagesStmt = this.db.prepare(`
      DELETE FROM processed_message_events
      WHERE created_at < ?
    `);
  }

  private init(): void {
    const hasSessions = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
      .get() as { name?: string } | undefined;

    if (!hasSessions) {
      this.createSchemaV2();
      return;
    }

    // Legacy schema (v1) had (user_id, context_id) as PK and no engine column.
    const columns = this.db
      .prepare("PRAGMA table_info(sessions)")
      .all() as Array<{ name?: unknown }>;
    const hasEngineColumn = columns.some((c) => c.name === "engine");
    if (!hasEngineColumn) {
      this.migrateV1ToV2();
      return;
    }

    // Ensure indices exist (idempotent).
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_last_used
      ON sessions (last_used_at DESC)
    `);

    this.ensureTokenColumns();
    this.ensureSessionSummariesSchema();
    this.ensureMessageEventSchema();
  }

  private createSchemaV2(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        user_id TEXT NOT NULL,
        context_id TEXT NOT NULL,
        engine TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at REAL NOT NULL,
        last_used_at REAL NOT NULL,
        message_count INTEGER DEFAULT 1,
        cumulative_context_tokens INTEGER DEFAULT 0,
        context_window INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, context_id, engine)
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_last_used
      ON sessions (last_used_at DESC)
    `);

    this.ensureSessionSummariesSchema();
    this.ensureMessageEventSchema();
  }

  private migrateV1ToV2(): void {
    console.log("[sessions] migrating legacy sessions schema v1 -> v2 (engine-scoped)");

    this.db.exec("BEGIN");
    try {
      this.db.exec(`
        CREATE TABLE sessions_v2 (
          user_id TEXT NOT NULL,
          context_id TEXT NOT NULL,
          engine TEXT NOT NULL,
          session_id TEXT NOT NULL,
          created_at REAL NOT NULL,
          last_used_at REAL NOT NULL,
          message_count INTEGER DEFAULT 1,
          PRIMARY KEY (user_id, context_id, engine)
        )
      `);

      // v1 sessions were only for Claude (single engine). Copy into engine="claude".
      this.db.exec(`
        INSERT INTO sessions_v2 (
          user_id, context_id, engine, session_id, created_at, last_used_at, message_count
        )
        SELECT user_id, context_id, 'claude', session_id, created_at, last_used_at, message_count
        FROM sessions
      `);

      this.db.exec("DROP TABLE sessions");
      this.db.exec("ALTER TABLE sessions_v2 RENAME TO sessions");

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sessions_last_used
        ON sessions (last_used_at DESC)
      `);

      this.ensureMessageEventSchema();

      this.db.exec("COMMIT");
      console.log("[sessions] migration complete");
    } catch (error: unknown) {
      this.db.exec("ROLLBACK");
      console.error("[sessions] migration failed:", error);
      throw error;
    }
  }

  getSession(userId: string, contextId: string, engine: EngineType = "claude"): string | null {
    const row = this.db
      .prepare(
        "SELECT session_id FROM sessions WHERE user_id = ? AND context_id = ? AND engine = ?",
      )
      .get(userId, contextId, engine) as { session_id: string } | undefined;

    return row?.session_id ?? null;
  }

  getSessionInfo(
    userId: string,
    contextId: string,
    engine: EngineType = "claude",
  ): SessionInfo | null {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE user_id = ? AND context_id = ? AND engine = ?")
      .get(userId, contextId, engine) as SessionRow | undefined;

    if (!row) {
      return null;
    }

    return {
      userId: row.user_id,
      contextId: row.context_id,
      engine: (row.engine as EngineType) || "claude",
      sessionId: row.session_id,
      createdAt: Number(row.created_at),
      lastUsedAt: Number(row.last_used_at),
      messageCount: Number(row.message_count),
    };
  }

  saveSession(userId: string, contextId: string, engine: EngineType, sessionId: string): void {
    const now = Date.now();
    const existing = this.db
      .prepare(
        "SELECT created_at, message_count FROM sessions WHERE user_id = ? AND context_id = ? AND engine = ?",
      )
      .get(userId, contextId, engine) as
      | { created_at: number; message_count: number }
      | undefined;

    const createdAt = existing?.created_at ?? now;
    const messageCount = (existing?.message_count ?? 0) + 1;

    this.db
      .prepare(`
        INSERT OR REPLACE INTO sessions (
          user_id, context_id, engine, session_id, created_at, last_used_at, message_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(userId, contextId, engine, sessionId, createdAt, now, messageCount);
  }

  deleteSession(userId: string, contextId: string, engine?: EngineType): void {
    if (engine) {
      this.db
        .prepare(
          "DELETE FROM sessions WHERE user_id = ? AND context_id = ? AND engine = ?",
        )
        .run(userId, contextId, engine);
      return;
    }

    // Delete all engine sessions for this user+context (matches the old behavior).
    this.db
      .prepare("DELETE FROM sessions WHERE user_id = ? AND context_id = ?")
      .run(userId, contextId);
  }

  touchSession(userId: string, contextId: string, engine: EngineType): void {
    this.db
      .prepare(`
        UPDATE sessions
        SET last_used_at = ?, message_count = message_count + 1
        WHERE user_id = ? AND context_id = ? AND engine = ?
      `)
      .run(Date.now(), userId, contextId, engine);
  }

  claimMessageEvent(messageId: string, dedupWindowMs: number, now = Date.now()): boolean {
    const cleanId = messageId.trim();
    if (!cleanId) {
      return false;
    }

    // Keep this bounded so the table does not grow forever.
    const cutoff = now - Math.max(0, dedupWindowMs);

    try {
      const tx = this.db.transaction(() => {
        this.pruneClaimedMessagesStmt.run(cutoff);
        const result = this.claimMessageStmt.run(cleanId, now);
        return result.changes === 1;
      });
      return tx();
    } catch (error: unknown) {
      // On temporary DB lock/IO issues, prefer processing over dropping user prompts.
      console.warn("[sessions] claimMessageEvent failed, allowing message:", error);
      return true;
    }
  }

  listSessions(engine?: EngineType): SessionInfo[] {
    const rows = (engine
      ? this.db
        .prepare("SELECT * FROM sessions WHERE engine = ? ORDER BY last_used_at DESC")
        .all(engine)
      : this.db.prepare("SELECT * FROM sessions ORDER BY last_used_at DESC").all()) as SessionRow[];

    return rows.map((row) => ({
      userId: row.user_id,
      contextId: row.context_id,
      engine: (row.engine as EngineType) || "claude",
      sessionId: row.session_id,
      createdAt: Number(row.created_at),
      lastUsedAt: Number(row.last_used_at),
      messageCount: Number(row.message_count),
    }));
  }

  cleanupOldSessions(maxAgeMs: number = 72 * 60 * 60 * 1000): number {
    const threshold = Date.now() - maxAgeMs;
    const result = this.db
      .prepare("DELETE FROM sessions WHERE last_used_at < ?")
      .run(threshold);
    return result.changes;
  }

  updateSessionTokens(
    userId: string,
    contextId: string,
    engine: EngineType,
    contextTokens: number,
    contextWindow: number,
  ): void {
    this.db
      .prepare(`
        UPDATE sessions
        SET cumulative_context_tokens = ?, context_window = ?
        WHERE user_id = ? AND context_id = ? AND engine = ?
      `)
      .run(contextTokens, contextWindow, userId, contextId, engine);
  }

  saveSummary(
    userId: string,
    contextId: string,
    engine: EngineType,
    summary: string,
    sourceSessionId: string | null,
    contextTokens: number,
  ): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO session_summaries (
          user_id, context_id, engine, summary, created_at,
          source_session_id, context_tokens_at_rotation
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(userId, contextId, engine, summary, Date.now(), sourceSessionId, contextTokens);
  }

  consumeSummary(userId: string, contextId: string, engine: EngineType): string | null {
    const row = this.db
      .prepare(
        "SELECT summary FROM session_summaries WHERE user_id = ? AND context_id = ? AND engine = ?",
      )
      .get(userId, contextId, engine) as { summary: string } | undefined;

    if (!row) {
      return null;
    }

    this.db
      .prepare(
        "DELETE FROM session_summaries WHERE user_id = ? AND context_id = ? AND engine = ?",
      )
      .run(userId, contextId, engine);

    return row.summary;
  }

  cleanupOldSummaries(maxAgeMs: number = 72 * 60 * 60 * 1000): number {
    const threshold = Date.now() - maxAgeMs;
    const result = this.db
      .prepare("DELETE FROM session_summaries WHERE created_at < ?")
      .run(threshold);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  private ensureTokenColumns(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(sessions)")
      .all() as Array<{ name?: unknown }>;
    const hasTokenColumn = columns.some((c) => c.name === "cumulative_context_tokens");
    if (!hasTokenColumn) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN cumulative_context_tokens INTEGER DEFAULT 0");
      this.db.exec("ALTER TABLE sessions ADD COLUMN context_window INTEGER DEFAULT 0");
    }
  }

  private ensureSessionSummariesSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_summaries (
        user_id TEXT NOT NULL,
        context_id TEXT NOT NULL,
        engine TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at REAL NOT NULL,
        source_session_id TEXT,
        context_tokens_at_rotation INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, context_id, engine)
      )
    `);
  }

  private ensureMessageEventSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_message_events (
        message_id TEXT PRIMARY KEY,
        created_at REAL NOT NULL
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_processed_message_events_created_at
      ON processed_message_events (created_at DESC)
    `);
  }
}
