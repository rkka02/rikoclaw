import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import type { Config } from "../utils/config.js";
import { ClaudeSessionScanner } from "./claude-session-scanner.js";
import { PTYSession } from "./pty-session.js";
import type { SessionManager } from "./session-manager.js";

// Client → Server message types
interface CreateMsg {
  type: "create";
  cols: number;
  rows: number;
  tool?: "claude" | "codex";
}
interface ResumeMsg {
  type: "resume";
  sessionId: string;
  cols: number;
  rows: number;
}
interface ContinueMsg {
  type: "continue";
  cols: number;
  rows: number;
  tool?: "claude" | "codex";
}
interface InputMsg {
  type: "input";
  data: string; // base64
}
interface ResizeMsg {
  type: "resize";
  cols: number;
  rows: number;
}
interface ListSessionsMsg {
  type: "list_sessions";
}
interface DetachMsg {
  type: "detach";
}
interface KillMsg {
  type: "kill";
}
interface PingMsg {
  type: "ping";
}

type ClientMessage =
  | CreateMsg
  | ResumeMsg
  | ContinueMsg
  | InputMsg
  | ResizeMsg
  | ListSessionsMsg
  | DetachMsg
  | KillMsg
  | PingMsg;

export class PTYRelayManager {
  private readonly config: Config;
  private readonly sessions: SessionManager;
  private readonly scanner: ClaudeSessionScanner;
  private readonly ptySessions = new Map<string, PTYSession>();
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private orphanTimer: NodeJS.Timeout | null = null;

  // Track which WS client is attached to which PTY
  private clientPty = new WeakMap<WebSocket, string>();

  constructor(config: Config, sessions: SessionManager) {
    this.config = config;
    this.sessions = sessions;
    this.scanner = new ClaudeSessionScanner(sessions);
  }

  start(): void {
    if (!this.config.ptyRelayEnabled) {
      console.log("[pty-relay] disabled via config");
      return;
    }

    if (!this.config.ptyRelayToken) {
      console.warn("[pty-relay] PTY_RELAY_TOKEN not set, relay disabled");
      return;
    }

    this.server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });

    // Prevent the whole bot from crashing if the relay can't bind (e.g. port already in use).
    this.server.on("error", (error: unknown) => {
      const err = error as { code?: string; message?: string };
      const code = err.code || "";
      if (code === "EADDRINUSE") {
        console.error(
          `[pty-relay] port ${this.config.ptyRelayPort} is already in use; relay disabled. ` +
            "Set PTY_RELAY_PORT to a free port or set PTY_RELAY_ENABLED=false.",
        );
      } else {
        console.error("[pty-relay] server error, relay disabled:", err.message || String(error));
      }

      // Best-effort cleanup; keep the Discord bot running.
      try {
        if (this.orphanTimer) {
          clearInterval(this.orphanTimer);
          this.orphanTimer = null;
        }
        if (this.wss) {
          for (const client of this.wss.clients) {
            client.close();
          }
          this.wss.close();
          this.wss = null;
        }
        if (this.server) {
          try {
            this.server.close();
          } catch {
            // ignore (server may not be listening)
          }
          this.server = null;
        }
      } catch {
        // ignore
      }
    });

    this.wss = new WebSocketServer({ noServer: true });

    this.server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url || "/", `http://${request.headers.host}`);

      // Path check
      if (url.pathname !== "/pty") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      // Auth check
      const token = url.searchParams.get("token");
      if (token !== this.config.ptyRelayToken) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(request, socket, head, (ws) => {
        this.wss!.emit("connection", ws, request);
      });
    });

    this.wss.on("connection", (ws) => {
      console.log("[pty-relay] client connected");

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as ClientMessage;
          this.handleMessage(ws, msg);
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : String(error);
          console.error("[pty-relay] message handling error:", errMsg);
          this.sendError(ws, errMsg);
        }
      });

      ws.on("close", () => {
        console.log("[pty-relay] client disconnected");
        this.handleDisconnect(ws);
      });
    });

    this.server.listen(this.config.ptyRelayPort, () => {
      console.log(
        `[pty-relay] listening on port ${this.config.ptyRelayPort}`,
      );
    });

    // Orphan cleanup timer
    this.orphanTimer = setInterval(() => {
      this.cleanupOrphans();
    }, 60_000);
    this.orphanTimer.unref?.();
  }

  stop(): void {
    if (this.orphanTimer) {
      clearInterval(this.orphanTimer);
      this.orphanTimer = null;
    }

    // Kill all PTY sessions
    for (const [id, session] of this.ptySessions) {
      console.log(`[pty-relay] killing PTY ${id}`);
      session.kill();
    }
    this.ptySessions.clear();

    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close();
      }
      this.wss.close();
      this.wss = null;
    }

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private handleMessage(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case "create":
        this.handleCreate(ws, msg);
        break;
      case "resume":
        this.handleResume(ws, msg);
        break;
      case "continue":
        this.handleContinue(ws, msg);
        break;
      case "input":
        this.handleInput(ws, msg);
        break;
      case "resize":
        this.handleResize(ws, msg);
        break;
      case "list_sessions":
        this.handleListSessions(ws);
        break;
      case "detach":
        this.handleDetach(ws);
        break;
      case "kill":
        this.handleKill(ws);
        break;
      case "ping":
        this.send(ws, { type: "pong" });
        break;
      default:
        this.sendError(ws, `unknown message type: ${(msg as { type: string }).type}`);
    }
  }

  private resolveToolPath(tool?: "claude" | "codex"): string {
    return tool === "codex" ? this.config.codexPath : this.config.claudePath;
  }

  private handleCreate(ws: WebSocket, msg: CreateMsg): void {
    if (this.ptySessions.size >= this.config.ptyRelayMaxSessions) {
      this.sendError(ws, "max sessions reached");
      return;
    }

    // Detach from current PTY if attached
    this.detachClient(ws);

    const toolPath = this.resolveToolPath(msg.tool);
    const ptyId = crypto.randomUUID();
    const session = new PTYSession(
      ptyId,
      toolPath,
      [],
      msg.cols || 80,
      msg.rows || 24,
      process.cwd(),
    );

    this.ptySessions.set(ptyId, session);
    this.clientPty.set(ws, ptyId);

    session.attach(
      (data) => this.sendOutput(ws, data),
      (exitCode) => this.handlePtyExit(ws, ptyId, exitCode),
    );

    this.send(ws, { type: "session_started", ptyId });
    console.log(`[pty-relay] created PTY ${ptyId} tool=${msg.tool || "claude"} pid=${session.pid}`);
  }

  private handleResume(ws: WebSocket, msg: ResumeMsg): void {
    // Check if there's already an active PTY for this session
    const existingPty = this.findPtyByClaudeSession(msg.sessionId);
    if (existingPty) {
      // Reattach to existing PTY
      this.detachClient(ws);
      this.clientPty.set(ws, existingPty.ptyId);

      const scrollback = existingPty.attach(
        (data) => this.sendOutput(ws, data),
        (exitCode) => this.handlePtyExit(ws, existingPty.ptyId, exitCode),
      );

      if (msg.cols && msg.rows) {
        existingPty.resize(msg.cols, msg.rows);
      }

      // Send scrollback for state restoration
      if (scrollback.length > 0) {
        this.sendOutput(ws, scrollback.toString("utf-8"));
      }

      this.send(ws, {
        type: "session_started",
        ptyId: existingPty.ptyId,
        claudeSessionId: msg.sessionId,
      });
      console.log(`[pty-relay] reattached to PTY ${existingPty.ptyId}`);
      return;
    }

    // Create new PTY with --resume
    if (this.ptySessions.size >= this.config.ptyRelayMaxSessions) {
      this.sendError(ws, "max sessions reached");
      return;
    }

    this.detachClient(ws);

    const ptyId = crypto.randomUUID();
    const session = new PTYSession(
      ptyId,
      this.config.claudePath,
      ["--resume", msg.sessionId],
      msg.cols || 80,
      msg.rows || 24,
      process.cwd(),
    );

    session.claudeSessionId = msg.sessionId;
    this.ptySessions.set(ptyId, session);
    this.clientPty.set(ws, ptyId);

    session.attach(
      (data) => this.sendOutput(ws, data),
      (exitCode) => this.handlePtyExit(ws, ptyId, exitCode),
    );

    this.send(ws, {
      type: "session_started",
      ptyId,
      claudeSessionId: msg.sessionId,
    });
    console.log(
      `[pty-relay] created PTY ${ptyId} --resume ${msg.sessionId}`,
    );
  }

  private handleContinue(ws: WebSocket, msg: ContinueMsg): void {
    if (msg.tool === "codex") {
      this.sendError(ws, "codex does not support --continue");
      return;
    }

    if (this.ptySessions.size >= this.config.ptyRelayMaxSessions) {
      this.sendError(ws, "max sessions reached");
      return;
    }

    this.detachClient(ws);

    const ptyId = crypto.randomUUID();
    const session = new PTYSession(
      ptyId,
      this.config.claudePath,
      ["--continue"],
      msg.cols || 80,
      msg.rows || 24,
      process.cwd(),
    );

    this.ptySessions.set(ptyId, session);
    this.clientPty.set(ws, ptyId);

    session.attach(
      (data) => this.sendOutput(ws, data),
      (exitCode) => this.handlePtyExit(ws, ptyId, exitCode),
    );

    this.send(ws, { type: "session_started", ptyId });
    console.log(`[pty-relay] created PTY ${ptyId} --continue`);
  }

  private handleInput(ws: WebSocket, msg: InputMsg): void {
    const ptyId = this.clientPty.get(ws);
    if (!ptyId) {
      this.sendError(ws, "not attached to any PTY session");
      return;
    }

    const session = this.ptySessions.get(ptyId);
    if (!session) {
      this.sendError(ws, "PTY session not found");
      return;
    }

    const decoded = Buffer.from(msg.data, "base64").toString("utf-8");
    session.write(decoded);
  }

  private handleResize(ws: WebSocket, msg: ResizeMsg): void {
    const ptyId = this.clientPty.get(ws);
    if (!ptyId) return;

    const session = this.ptySessions.get(ptyId);
    if (!session) return;

    session.resize(msg.cols, msg.rows);
  }

  private handleListSessions(ws: WebSocket): void {
    const claudeSessions = this.scanner.scan();
    const activePtys = Array.from(this.ptySessions.values()).map((s) => s.info);

    this.send(ws, {
      type: "session_list",
      sessions: claudeSessions,
      activePtys,
    });
  }

  private handleDetach(ws: WebSocket): void {
    this.detachClient(ws);
    this.send(ws, { type: "pong" }); // ACK
  }

  private handleKill(ws: WebSocket): void {
    const ptyId = this.clientPty.get(ws);
    if (!ptyId) return;

    const session = this.ptySessions.get(ptyId);
    if (session) {
      session.kill();
      this.ptySessions.delete(ptyId);
    }
    this.clientPty.delete(ws);
  }

  private handleDisconnect(ws: WebSocket): void {
    const ptyId = this.clientPty.get(ws);
    if (!ptyId) return;

    const session = this.ptySessions.get(ptyId);
    if (session) {
      session.detach();
      console.log(
        `[pty-relay] PTY ${ptyId} detached (client disconnected), keeping alive`,
      );
    }
    this.clientPty.delete(ws);
  }

  private handlePtyExit(ws: WebSocket, ptyId: string, exitCode: number): void {
    console.log(`[pty-relay] PTY ${ptyId} exited code=${exitCode}`);
    this.ptySessions.delete(ptyId);

    if (ws.readyState === WebSocket.OPEN) {
      this.send(ws, { type: "session_ended", ptyId, exitCode });
    }
  }

  private detachClient(ws: WebSocket): void {
    const ptyId = this.clientPty.get(ws);
    if (!ptyId) return;

    const session = this.ptySessions.get(ptyId);
    if (session) {
      session.detach();
    }
    this.clientPty.delete(ws);
  }

  private findPtyByClaudeSession(sessionId: string): PTYSession | null {
    for (const session of this.ptySessions.values()) {
      if (session.claudeSessionId === sessionId && !session.exited) {
        return session;
      }
    }
    return null;
  }

  private cleanupOrphans(): void {
    const now = Date.now();
    const timeoutMs = this.config.ptyRelayOrphanTimeout * 1000;

    for (const [id, session] of this.ptySessions) {
      if (
        session.detachedAt !== null &&
        now - session.detachedAt > timeoutMs
      ) {
        console.log(`[pty-relay] killing orphaned PTY ${id}`);
        session.kill();
        this.ptySessions.delete(id);
      }
    }
  }

  private sendOutput(ws: WebSocket, data: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      const encoded = Buffer.from(data, "utf-8").toString("base64");
      this.send(ws, { type: "output", data: encoded });
    }
  }

  private sendError(ws: WebSocket, message: string): void {
    this.send(ws, { type: "error", message });
  }

  private send(ws: WebSocket, msg: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}
