import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { IPty } from "node-pty";

const require = createRequire(import.meta.url);
const nodePty = require("node-pty") as typeof import("node-pty");

const MAX_SCROLLBACK_BYTES = 50 * 1024; // 50 KB

export interface PTYSessionInfo {
  ptyId: string;
  cols: number;
  rows: number;
  createdAt: number;
  lastActivity: number;
  detachedAt: number | null;
  claudeSessionId: string | null;
  pid: number;
}

export class PTYSession {
  readonly ptyId: string;
  readonly createdAt: number;

  private pty: IPty;
  private scrollback = Buffer.alloc(0);
  private _detachedAt: number | null = null;
  private _lastActivity: number;
  private _claudeSessionId: string | null = null;
  private _onData: ((data: string) => void) | null = null;
  private _onExit: ((exitCode: number, signal: number) => void) | null = null;
  private _exited = false;
  private _exitCode = 0;

  constructor(
    ptyId: string,
    claudePath: string,
    args: string[],
    cols: number,
    rows: number,
    cwd: string,
  ) {
    this.ptyId = ptyId;
    this.createdAt = Date.now();
    this._lastActivity = Date.now();

    const resolvedPath = resolveExecutable(claudePath);
    console.log(`[pty-session] spawning: ${resolvedPath} ${args.join(" ")}`);

    this.pty = nodePty.spawn(resolvedPath, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>,
    });

    this.pty.onData((data: string) => {
      this._lastActivity = Date.now();
      this.appendScrollback(data);
      if (this._onData) {
        this._onData(data);
      }
    });

    this.pty.onExit(({ exitCode, signal }) => {
      this._exited = true;
      this._exitCode = exitCode ?? 0;
      if (this._onExit) {
        this._onExit(exitCode ?? 0, signal ?? 0);
      }
    });
  }

  get detachedAt(): number | null {
    return this._detachedAt;
  }

  get lastActivity(): number {
    return this._lastActivity;
  }

  get claudeSessionId(): string | null {
    return this._claudeSessionId;
  }

  set claudeSessionId(id: string | null) {
    this._claudeSessionId = id;
  }

  get exited(): boolean {
    return this._exited;
  }

  get exitCode(): number {
    return this._exitCode;
  }

  get pid(): number {
    return this.pty.pid;
  }

  get info(): PTYSessionInfo {
    return {
      ptyId: this.ptyId,
      cols: 0,
      rows: 0,
      createdAt: this.createdAt,
      lastActivity: this._lastActivity,
      detachedAt: this._detachedAt,
      claudeSessionId: this._claudeSessionId,
      pid: this.pty.pid,
    };
  }

  attach(
    onData: (data: string) => void,
    onExit: (exitCode: number, signal: number) => void,
  ): Buffer {
    this._onData = onData;
    this._onExit = onExit;
    this._detachedAt = null;

    const buf = this.scrollback;
    return buf;
  }

  detach(): void {
    this._onData = null;
    this._onExit = null;
    this._detachedAt = Date.now();
  }

  write(data: string): void {
    if (!this._exited) {
      this.pty.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (!this._exited) {
      this.pty.resize(cols, rows);
    }
  }

  kill(): void {
    if (!this._exited) {
      this.pty.kill();
    }
  }

  private appendScrollback(data: string): void {
    const chunk = Buffer.from(data, "utf-8");
    this.scrollback = Buffer.concat([this.scrollback, chunk]);

    if (this.scrollback.length > MAX_SCROLLBACK_BYTES) {
      this.scrollback = this.scrollback.subarray(
        this.scrollback.length - MAX_SCROLLBACK_BYTES,
      );
    }
  }
}

function resolveExecutable(name: string): string {
  if (path.isAbsolute(name) && fs.existsSync(name)) {
    return name;
  }

  try {
    const resolved = execSync(`which ${name}`, { encoding: "utf-8" }).trim();
    if (resolved) return resolved;
  } catch {
    // not found
  }

  return name;
}
