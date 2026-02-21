import { spawn } from "node:child_process";
import type { Config } from "../utils/config.js";
import type { EngineType, LLMRunner, RunEvent, RunOptions, RunResult, UsageInfo } from "./llm-runner.js";

export type { RunOptions };
export type ClaudeResult = RunResult;

interface ClaudeJsonOutput {
  subtype?: string;
  type?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  error?: string;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  modelUsage?: Record<string, {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    contextWindow?: number;
  }>;
}

export class ClaudeRunner implements LLMRunner {
  readonly engineName: EngineType = "claude";
  readonly supportsMaxTurnsRetry = true;
  readonly supportsSessionResume = true;
  private activeRunId = 0;
  private activeAbort: (() => void) | null = null;

  constructor(private readonly config: Config) {}

  cancelCurrentRun(): boolean {
    const abort = this.activeAbort;
    if (!abort) {
      return false;
    }

    abort();
    return true;
  }

  async run(options: RunOptions): Promise<RunResult> {
    const args = this.buildArgs(options);
    const startTime = Date.now();
    const selectedMaxTurns =
      options.maxTurns === undefined ? this.config.claudeMaxTurns : options.maxTurns;
    console.log(
      `[claude] run start resume=${options.sessionId ? "yes" : "no"} model=${options.model || this.config.claudeModel || "(default)"} maxTurns=${selectedMaxTurns ?? "default"} promptLen=${options.prompt.length}`,
    );

    return await this.runWithSpawn(
      args,
      startTime,
      options.onEvent,
      options.onAbortReady,
      options.envOverrides,
    );
  }

  private buildArgs(options: RunOptions): string[] {
    const wantsStream = Boolean(options.onEvent);
    const outputFormat = wantsStream ? "stream-json" : "json";
    const args = ["-p", options.prompt, "--output-format", outputFormat];

    // Claude Code requires --verbose when --print + --output-format=stream-json.
    if (outputFormat === "stream-json") {
      args.push("--verbose", "--include-partial-messages");
    }

    if (this.config.claudeDangerouslySkipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    if (this.config.claudePermissionMode) {
      args.push("--permission-mode", this.config.claudePermissionMode);
    }

    if (this.config.claudeAddDirs.length > 0) {
      args.push("--add-dir", ...this.config.claudeAddDirs);
    }

    const selectedMaxTurns =
      options.maxTurns === undefined ? this.config.claudeMaxTurns : options.maxTurns;
    if (selectedMaxTurns !== null) {
      args.push("--max-turns", String(selectedMaxTurns));
    }

    if (options.sessionId) {
      args.push("--resume", options.sessionId);
    }
    if (options.systemPrompt) {
      args.push("--system-prompt", options.systemPrompt);
    }

    const selectedModel = options.model ?? this.config.claudeModel;
    if (selectedModel) {
      args.push("--model", selectedModel);
    }

    return args;
  }

  private async runWithSpawn(
    args: string[],
    startTime: number,
    onEvent?: (event: RunEvent) => void,
    onAbortReady?: (abort: () => void) => void,
    envOverrides?: Record<string, string>,
  ): Promise<RunResult> {
    const maxCapturedBytes = 10 * 1024 * 1024;
    const runId = ++this.activeRunId;

    return await new Promise<RunResult>((resolve) => {
      let settled = false;
      let stdout = "";
      let stderr = "";
      let streamBuffer = "";
      let didTimeout = false;
      let didCancel = false;
      let timer: NodeJS.Timeout | null = null;
      const toolNames = new Map<string, string>();

      const finish = (result: RunResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (this.activeRunId === runId) {
          this.activeAbort = null;
        }
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        resolve(result);
      };

      const child = spawn(this.config.claudePath, args, {
        env: { ...process.env, ...(envOverrides || {}) },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        windowsHide: true,
      });

      const emit = (event: RunEvent): void => {
        if (!onEvent || settled) {
          return;
        }
        try {
          onEvent(event);
        } catch (error: unknown) {
          console.error("[claude] onEvent callback failed:", error);
        }
      };

      this.activeAbort = () => {
        if (didTimeout || didCancel || settled) {
          return;
        }
        didCancel = true;
        console.log(`[claude] run cancel requested pid=${child.pid ?? "unknown"}`);
        this.killProcessTree(child.pid);
      };
      if (onAbortReady) {
        try {
          onAbortReady(this.activeAbort);
        } catch (error: unknown) {
          console.error("[claude] onAbortReady callback failed:", error);
        }
      }

      const append = (prev: string, chunk: Buffer | string): string => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const next = prev + text;
        if (next.length <= maxCapturedBytes) {
          return next;
        }
        return next.slice(next.length - maxCapturedBytes);
      };

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout = append(stdout, chunk);

        if (!onEvent || settled) {
          return;
        }

        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        streamBuffer += text;
        let newlineIndex = streamBuffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = streamBuffer.slice(0, newlineIndex).trim();
          streamBuffer = streamBuffer.slice(newlineIndex + 1);
          this.handleStreamLine(line, toolNames, emit);
          newlineIndex = streamBuffer.indexOf("\n");
        }
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr = append(stderr, chunk);
      });

      child.on("error", (error: unknown) => {
        if (didCancel) {
          const cancelled: RunResult = {
            success: false,
            text: "",
            sessionId: null,
            error: "요청이 중단되었습니다.",
            durationMs: Date.now() - startTime,
            isTimeout: false,
            usage: null,
          };
          console.log(`[claude] run cancelled durationMs=${cancelled.durationMs}`);
          finish(cancelled);
          return;
        }

        const handled = this.handleError({ ...(toErrorRecord(error)), stderr }, startTime);
        console.log(
          `[claude] run error durationMs=${handled.durationMs} timeout=${handled.isTimeout} error=${handled.error ?? "unknown"}`,
        );
        finish(handled);
      });

      child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        if (didTimeout) {
          return;
        }
        if (didCancel) {
          const cancelled: RunResult = {
            success: false,
            text: "",
            sessionId: null,
            error: "요청이 중단되었습니다.",
            durationMs: Date.now() - startTime,
            isTimeout: false,
            usage: null,
          };
          console.log(`[claude] run cancelled durationMs=${cancelled.durationMs}`);
          finish(cancelled);
          return;
        }

        if (onEvent && streamBuffer.trim()) {
          this.handleStreamLine(streamBuffer.trim(), toolNames, emit);
        }

        const parsed = this.parseOutput(stdout, stderr, startTime, code);
        if (code === 0 || parsed.success) {
          console.log(
            `[claude] run end success=${parsed.success} durationMs=${parsed.durationMs} sessionId=${parsed.sessionId ? "yes" : "no"} error=${parsed.error ? "yes" : "no"} exitCode=${code ?? "unknown"} signal=${signal ?? "none"}`,
          );
          finish(parsed);
          return;
        }

        console.log(
          `[claude] run error durationMs=${parsed.durationMs} timeout=${parsed.isTimeout} error=${parsed.error ?? "unknown"} exitCode=${code ?? "unknown"} signal=${signal ?? "none"}`,
        );
        finish(parsed);
      });

      timer = setTimeout(() => {
        didTimeout = true;
        const timeoutResult: RunResult = {
          success: false,
          text: "",
          sessionId: null,
          error: `응답 시간 초과 (${this.config.claudeTimeout / 1000}초)`,
          durationMs: Date.now() - startTime,
          isTimeout: true,
          usage: null,
        };
        console.log(
          `[claude] run timeout durationMs=${timeoutResult.durationMs}; killing process tree`,
        );
        this.killProcessTree(child.pid);
        finish(timeoutResult);
      }, this.config.claudeTimeout);
    });
  }

  private handleStreamLine(
    line: string,
    toolNames: Map<string, string>,
    emit: (event: RunEvent) => void,
  ): void {
    if (!line) {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(line) as unknown;
    } catch {
      return;
    }

    if (typeof payload !== "object" || payload === null) {
      return;
    }

    const record = payload as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";

    if (type === "stream_event") {
      const event = record.event;
      if (typeof event !== "object" || event === null) {
        return;
      }

      const ev = event as Record<string, unknown>;
      const evType = typeof ev.type === "string" ? ev.type : "";

      if (evType === "content_block_delta") {
        const delta = ev.delta;
        if (typeof delta !== "object" || delta === null) {
          return;
        }
        const d = delta as Record<string, unknown>;
        const dType = typeof d.type === "string" ? d.type : "";
        if (dType === "text_delta") {
          const text = typeof d.text === "string" ? d.text : "";
          if (text) {
            emit({ type: "assistant_delta", text });
          }
        }
      }

      return;
    }

    if (type === "assistant") {
      const message = record.message;
      if (typeof message !== "object" || message === null) {
        return;
      }

      const content = (message as Record<string, unknown>).content;
      if (!Array.isArray(content)) {
        return;
      }

      for (const block of content) {
        if (typeof block !== "object" || block === null) {
          continue;
        }
        const b = block as Record<string, unknown>;
        if (b.type !== "tool_use") {
          continue;
        }
        const toolUseId = typeof b.id === "string" ? b.id : undefined;
        const name = typeof b.name === "string" ? b.name : "tool";
        const input = b.input ?? {};
        if (toolUseId) {
          toolNames.set(toolUseId, name);
        }
        emit({ type: "tool_use", toolUseId, name, input });
      }

      return;
    }

    if (type === "user") {
      const toolUseResult = record.tool_use_result;
      let stdout: string | undefined;
      let stderr: string | undefined;
      let interrupted: boolean | undefined;
      if (typeof toolUseResult === "object" && toolUseResult !== null) {
        const r = toolUseResult as Record<string, unknown>;
        if (typeof r.stdout === "string") {
          stdout = r.stdout;
        }
        if (typeof r.stderr === "string") {
          stderr = r.stderr;
        }
        if (typeof r.interrupted === "boolean") {
          interrupted = r.interrupted;
        }
      }

      const message = record.message;
      const content = typeof message === "object" && message !== null ? (message as Record<string, unknown>).content : undefined;
      if (!Array.isArray(content)) {
        if (stdout || stderr) {
          emit({
            type: "tool_result",
            stdout: truncateEventText(stdout),
            stderr: truncateEventText(stderr),
            stdoutLen: stdout?.length,
            stderrLen: stderr?.length,
            interrupted,
          });
        }
        return;
      }

      for (const block of content) {
        if (typeof block !== "object" || block === null) {
          continue;
        }
        const b = block as Record<string, unknown>;
        if (b.type !== "tool_result") {
          continue;
        }
        const toolUseId = typeof b.tool_use_id === "string" ? b.tool_use_id : undefined;
        const name = toolUseId ? toolNames.get(toolUseId) : undefined;
        const isError = typeof b.is_error === "boolean" ? b.is_error : undefined;

        emit({
          type: "tool_result",
          toolUseId,
          name,
          stdout: truncateEventText(stdout),
          stderr: truncateEventText(stderr),
          stdoutLen: stdout?.length,
          stderrLen: stderr?.length,
          interrupted,
          isError,
        });
      }

      return;
    }
  }

  private killProcessTree(pid: number | undefined): void {
    if (!pid || pid <= 0) {
      return;
    }

    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref();
      return;
    }

    try {
      // Send to the spawned process group first (detached=true on non-Windows).
      process.kill(-pid, "SIGTERM");
    } catch {
      // Fallback for environments where process groups are unavailable.
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // noop
      }
    }

    const hardKill = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // noop
        }
      }
    }, 300);
    hardKill.unref?.();
  }

  private extractUsage(parsed: ClaudeJsonOutput | null): UsageInfo | null {
    if (!parsed?.usage) {
      return null;
    }

    const u = parsed.usage;
    const inputTokens = u.input_tokens || 0;
    const cacheCreation = u.cache_creation_input_tokens || 0;
    const cacheRead = u.cache_read_input_tokens || 0;
    const outputTokens = u.output_tokens || 0;
    const totalContextTokens = inputTokens + cacheCreation + cacheRead;

    let contextWindow: number | null = null;
    if (parsed.modelUsage) {
      const firstModel = Object.keys(parsed.modelUsage)[0];
      if (firstModel && parsed.modelUsage[firstModel]?.contextWindow) {
        contextWindow = parsed.modelUsage[firstModel].contextWindow!;
      }
    }

    return {
      inputTokens,
      cacheCreationInputTokens: cacheCreation,
      cacheReadInputTokens: cacheRead,
      outputTokens,
      contextWindow,
      totalContextTokens,
    };
  }

  private parseOutput(
    stdout: string,
    stderr: string,
    startTime: number,
    exitCode: number | null,
  ): RunResult {
    const durationMs = Date.now() - startTime;
    const parsed = this.parseJson(stdout);
    const stderrTrimmed = stderr.trim();
    const stdoutTrimmed = stdout.trim();
    const usage = this.extractUsage(parsed);

    if (parsed) {
      const subtype = parsed.subtype || "";
      const isError = parsed.is_error === true;
      const resultText = (parsed.result || "").trim();
      const explicitError = parsed.error?.trim() || "";

      const isSuccess = subtype === "success" && !isError;
      if (isSuccess) {
        return {
          success: true,
          text: resultText.length > 0 ? parsed.result || "" : "(completed with no output)",
          sessionId: parsed.session_id || null,
          error: null,
          durationMs,
          isTimeout: false,
          usage,
        };
      }

      const candidates: Array<string | null> = [
        explicitError || null,
        // Claude CLI sometimes returns exitCode=1 with a valid JSON "result" containing an error message.
        // Treat that "result" as an error when is_error=true.
        isError ? resultText || null : null,
        this.classifySubtype(subtype),
        this.classifyStderr(stderrTrimmed),
        stderrTrimmed ? stderrTrimmed.slice(0, 500) : null,
        // Some error subtypes might include a useful message in result.
        !isError && subtype !== "success" && resultText ? resultText : null,
        exitCode !== 0 ? `Claude exited with code ${exitCode ?? "unknown"}` : null,
      ];
      const errorMessage =
        candidates.find((candidate) => Boolean(candidate)) ||
        `Claude: ${subtype || "failed"}`;

      return {
        success: false,
        text: "",
        sessionId: parsed.session_id || null,
        error: errorMessage,
        durationMs,
        isTimeout: false,
        usage,
      };
    }

    if (stdoutTrimmed.length > 0) {
      if (exitCode === 0) {
        return {
          success: true,
          text: stdoutTrimmed,
          sessionId: null,
          error: null,
          durationMs,
          isTimeout: false,
          usage: null,
        };
      }

      const classified =
        this.classifyStderr(stdoutTrimmed) || this.classifyStderr(stderrTrimmed);
      return {
        success: false,
        text: "",
        sessionId: null,
        error: classified || stdoutTrimmed.slice(0, 500),
        durationMs,
        isTimeout: false,
        usage: null,
      };
    }

    const classified = this.classifyStderr(stderrTrimmed);
    if (classified) {
      return {
        success: false,
        text: "",
        sessionId: null,
        error: classified,
        durationMs,
        isTimeout: false,
        usage: null,
      };
    }

    if (stderrTrimmed.length > 0) {
      return {
        success: false,
        text: "",
        sessionId: null,
        error: stderrTrimmed.slice(0, 500),
        durationMs,
        isTimeout: false,
        usage: null,
      };
    }

    if (exitCode !== 0) {
      return {
        success: false,
        text: "",
        sessionId: null,
        error: `Claude exited with code ${exitCode ?? "unknown"}`,
        durationMs,
        isTimeout: false,
        usage: null,
      };
    }

    return {
      success: false,
      text: "",
      sessionId: null,
      error: "Claude가 빈 응답을 반환했습니다.",
      durationMs,
      isTimeout: false,
      usage: null,
    };
  }

  private parseJson(stdout: string): ClaudeJsonOutput | null {
    const trimmed = stdout.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return JSON.parse(trimmed) as ClaudeJsonOutput;
    } catch {
      // Claude CLI가 로그 라인을 섞어 출력한 경우 마지막 JSON 라인을 찾는다.
      const lines = trimmed.split("\n").map((line) => line.trim());
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line.startsWith("{")) {
          continue;
        }

        try {
          return JSON.parse(line) as ClaudeJsonOutput;
        } catch {
          // noop
        }
      }
      return null;
    }
  }

  private handleError(error: unknown, startTime: number): RunResult {
    const durationMs = Date.now() - startTime;
    const err = toErrorRecord(error);
    const stderrRaw = safeText(err.stderr);

    if (
      err.killed ||
      err.signal === "SIGTERM" ||
      err.code === "ETIMEDOUT" ||
      err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
      err.code === "TIMEOUT"
    ) {
      return {
        success: false,
        text: "",
        sessionId: null,
        error: `응답 시간 초과 (${this.config.claudeTimeout / 1000}초)`,
        durationMs,
        isTimeout: true,
        usage: null,
      };
    }

    if (err.code === "ENOENT") {
      return {
        success: false,
        text: "",
        sessionId: null,
        error: "Claude CLI를 찾을 수 없습니다. PATH를 확인해주세요.",
        durationMs,
        isTimeout: false,
        usage: null,
      };
    }

    const classified = this.classifyStderr(stderrRaw);
    if (classified) {
      return {
        success: false,
        text: "",
        sessionId: null,
        error: classified,
        durationMs,
        isTimeout: false,
        usage: null,
      };
    }

    const fallback = safeText(err.stderr) || safeText(err.message) || "알 수 없는 오류";
    return {
      success: false,
      text: "",
      sessionId: null,
      error: fallback.slice(0, 500),
      durationMs,
      isTimeout: false,
      usage: null,
    };
  }

  private classifyStderr(stderrRaw: string): string | null {
    const stderr = stderrRaw.toLowerCase();
    if (!stderr) {
      return null;
    }

    if (
      stderr.includes("auth") ||
      stderr.includes("login") ||
      stderr.includes("not logged in")
    ) {
      return "Claude Code 재로그인이 필요합니다. 서버에서 `claude login`을 실행해주세요.";
    }

    if (stderr.includes("rate limit")) {
      return "요청 한도 초과. 잠시 후 다시 시도해주세요.";
    }

    if (isTransientAnthropicApiError(stderrRaw)) {
      const requestId = extractRequestId(stderrRaw);
      if (requestId) {
        return `Claude API 일시 오류(서버 5xx)입니다. 잠시 후 다시 시도해주세요. request_id=${requestId}`;
      }
      return "Claude API 일시 오류(서버 5xx)입니다. 잠시 후 다시 시도해주세요.";
    }

    if (stderr.includes("session") || stderr.includes("resume")) {
      return stderrRaw.slice(0, 500);
    }

    return null;
  }

  private classifySubtype(subtypeRaw: string): string | null {
    const subtype = subtypeRaw.toLowerCase();
    if (!subtype) {
      return null;
    }

    if (subtype === "error_max_turns") {
      return "내부 작업 턴 제한(max_turns)에 도달했습니다.";
    }

    return null;
  }
}

function safeText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  return "";
}

function extractRequestId(text: string): string | null {
  const match = text.match(/\brequest_id["']?\s*[:=]\s*["']?([a-zA-Z0-9_-]+)\b/);
  if (!match) {
    return null;
  }
  return match[1] || null;
}

function isTransientAnthropicApiError(text: string): boolean {
  const normalized = text.toLowerCase();
  if (!normalized) {
    return false;
  }

  if (
    normalized.includes("internal server error")
    || normalized.includes("service unavailable")
    || normalized.includes("gateway timeout")
    || normalized.includes("bad gateway")
    || normalized.includes("overloaded")
    || normalized.includes("\"type\":\"api_error\"")
  ) {
    return true;
  }

  return /\bapi error:\s*5\d{2}\b/i.test(text) || /\bhttp\s*5\d{2}\b/i.test(text);
}

interface ErrorRecord {
  code?: string;
  killed?: boolean;
  signal?: string;
  stderr?: unknown;
  message?: unknown;
}

function toErrorRecord(error: unknown): ErrorRecord {
  if (typeof error === "object" && error !== null) {
    return error as ErrorRecord;
  }
  return { message: String(error) };
}

function truncateEventText(text: string | undefined, maxChars: number = 4000): string | undefined {
  if (!text) {
    return undefined;
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n…(truncated)`;
}
