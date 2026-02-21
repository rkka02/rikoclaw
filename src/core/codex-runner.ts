import { spawn } from "node:child_process";
import type { Config } from "../utils/config.js";
import type { EngineType, LLMRunner, RunEvent, RunOptions, RunResult, UsageInfo } from "./llm-runner.js";

interface CodexJsonEvent {
  type?: string;
  event?: string;
  // thread.started
  thread_id?: string;
  // item.completed
  item?: {
    type?: string;
    text?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  // error
  message?: string;
  // turn.completed usage
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class CodexRunner implements LLMRunner {
  readonly engineName: EngineType = "codex";
  readonly supportsMaxTurnsRetry = false;
  readonly supportsSessionResume = true;

  // Discord bot runs non-interactively; configure Codex CLI to run with full permissions so
  // it can actually write files / run installs without getting stuck on approval prompts.
  private readonly sandboxMode = "danger-full-access";
  private readonly approvalPolicy = "never";
  private readonly bypassApprovalsAndSandbox = true;

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
    const startTime = Date.now();
    console.log(
      `[codex] run start resume=${options.sessionId ? "yes" : "no"} model=${options.model || this.config.codexModel || "(default)"} promptLen=${options.prompt.length}`,
    );

    const args = this.buildArgs(options);
    return await this.runWithSpawn(
      args,
      startTime,
      options.onEvent,
      options.onAbortReady,
      options.envOverrides,
    );
  }

  private buildArgs(options: RunOptions): string[] {
    let prompt = options.prompt;
    if (options.systemPrompt) {
      prompt = `[System Instructions]\n${options.systemPrompt}\n\n[User Message]\n${prompt}`;
    }

    // Global options must come before the subcommand.
    const args: string[] = [
      "--sandbox",
      this.sandboxMode,
      "--ask-for-approval",
      this.approvalPolicy,
    ];

    if (this.config.codexEnableSearch) {
      args.push("--search");
    }

    args.push("exec");

    // Resume an existing session if a thread_id is available.
    if (options.sessionId) {
      args.push("resume");
    }

    if (this.bypassApprovalsAndSandbox) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    }

    // Keep this bot-friendly: JSONL events for streaming parsing.
    args.push("--json");

    const selectedModel = options.model ?? this.config.codexModel;
    if (selectedModel) {
      args.push("--model", selectedModel);
    }

    // Positional arguments last: [session_id] <prompt>
    if (options.sessionId) {
      args.push(options.sessionId);
    }
    args.push(prompt);

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

      const child = spawn(this.config.codexPath, args, {
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
          console.error("[codex] onEvent callback failed:", error);
        }
      };

      this.activeAbort = () => {
        if (didTimeout || didCancel || settled) {
          return;
        }
        didCancel = true;
        console.log(`[codex] run cancel requested pid=${child.pid ?? "unknown"}`);
        this.killProcessTree(child.pid);
      };
      if (onAbortReady) {
        try {
          onAbortReady(this.activeAbort);
        } catch (error: unknown) {
          console.error("[codex] onAbortReady callback failed:", error);
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
          this.handleJsonlLine(line, emit);
          newlineIndex = streamBuffer.indexOf("\n");
        }
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr = append(stderr, chunk);
      });

      child.on("error", (error: unknown) => {
        if (didCancel) {
          finish({
            success: false,
            text: "",
            sessionId: null,
            error: "요청이 중단되었습니다.",
            durationMs: Date.now() - startTime,
            isTimeout: false,
            usage: null,
          });
          return;
        }

        const handled = this.handleError(error, stderr, startTime);
        console.log(
          `[codex] run error durationMs=${handled.durationMs} error=${handled.error ?? "unknown"}`,
        );
        finish(handled);
      });

      child.on("close", (code: number | null) => {
        if (didTimeout) {
          return;
        }
        if (didCancel) {
          console.log(`[codex] run cancelled durationMs=${Date.now() - startTime}`);
          finish({
            success: false,
            text: "",
            sessionId: null,
            error: "요청이 중단되었습니다.",
            durationMs: Date.now() - startTime,
            isTimeout: false,
            usage: null,
          });
          return;
        }

        if (onEvent && streamBuffer.trim()) {
          this.handleJsonlLine(streamBuffer.trim(), emit);
        }

        const parsed = this.parseJsonlOutput(stdout, stderr, startTime);
        console.log(
          `[codex] run end code=${code} success=${parsed.success} durationMs=${parsed.durationMs} error=${parsed.error ? "yes" : "no"}`,
        );
        finish(parsed);
      });

      timer = setTimeout(() => {
        didTimeout = true;
        const timeoutResult: RunResult = {
          success: false,
          text: "",
          sessionId: null,
          error: `응답 시간 초과 (${this.config.codexTimeout / 1000}초)`,
          durationMs: Date.now() - startTime,
          isTimeout: true,
          usage: null,
        };
        console.log(
          `[codex] run timeout durationMs=${timeoutResult.durationMs}; killing process tree`,
        );
        this.killProcessTree(child.pid);
        finish(timeoutResult);
      }, this.config.codexTimeout);
    });
  }

  private handleJsonlLine(line: string, emit: (event: RunEvent) => void): void {
    if (!line) {
      return;
    }

    let event: CodexJsonEvent;
    try {
      event = JSON.parse(line) as CodexJsonEvent;
    } catch {
      return;
    }

    if (event.type === "error" || event.event === "error") {
      emit({ type: "status", message: event.message || "Codex error" });
      return;
    }

    const isAgentMessage = event.item?.type === "agent_message";
    const isItemCompleted = event.type === "item.completed" || event.event === "item.completed";
    const isItemDelta = event.type === "item.delta" || event.event === "item.delta";

    if ((isItemCompleted || isItemDelta) && isAgentMessage) {
      if (event.item?.text) {
        emit({ type: "assistant_delta", text: event.item.text });
      }
      const contents = event.item?.content || [];
      for (const part of contents) {
        if (part.type === "text" && part.text) {
          emit({ type: "assistant_delta", text: part.text });
        }
      }
    }
  }

  private parseJsonlOutput(stdout: string, stderr: string, startTime: number): RunResult {
    const durationMs = Date.now() - startTime;
    const lines = stdout.trim().split("\n").filter((line) => line.trim());
    let lastAgentMessage = "";
    let errorMessage: string | null = null;
    let threadId: string | null = null;
    let lastUsage: UsageInfo | null = null;

    for (const line of lines) {
      let event: CodexJsonEvent;
      try {
        event = JSON.parse(line) as CodexJsonEvent;
      } catch {
        continue;
      }

      // Capture thread_id from the first event that carries it.
      if (event.thread_id && !threadId) {
        threadId = event.thread_id;
      }

      if (event.type === "error" || event.event === "error") {
        errorMessage = event.message || "Codex error";
        continue;
      }

      // Capture usage from turn.completed events.
      if (event.type === "turn.completed" && event.usage) {
        const u = event.usage;
        const inputTokens = u.input_tokens || 0;
        const outputTokens = u.output_tokens || 0;
        lastUsage = {
          inputTokens,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens,
          contextWindow: null,
          totalContextTokens: inputTokens,
        };
      }

      // item.completed with agent_message content
      if (
        (event.type === "item.completed" || event.event === "item.completed") &&
        event.item?.type === "agent_message"
      ) {
        const text = this.extractAgentMessageText(event.item);
        if (text) {
          // Keep only the final completed assistant message for Discord output.
          lastAgentMessage = text;
        }
      }
    }

    if (threadId) {
      console.log(`[codex] captured thread_id=${threadId}`);
    }

    const text = lastAgentMessage.trim();

    if (errorMessage) {
      const classified = this.classifyError(errorMessage, stderr);
      return {
        success: false,
        text,
        sessionId: threadId,
        error: classified,
        durationMs,
        isTimeout: false,
        usage: lastUsage,
      };
    }

    if (text.length > 0) {
      return {
        success: true,
        text,
        sessionId: threadId,
        error: null,
        durationMs,
        isTimeout: false,
        usage: lastUsage,
      };
    }

    // Fallback: try raw stdout if no JSONL events parsed
    const rawStdout = stdout.trim();
    if (rawStdout.length > 0 && lines.length === 0) {
      return {
        success: true,
        text: rawStdout,
        sessionId: threadId,
        error: null,
        durationMs,
        isTimeout: false,
        usage: null,
      };
    }

    const stderrTrimmed = stderr.trim();
    if (stderrTrimmed) {
      const classified = this.classifyError(stderrTrimmed, stderr);
      return {
        success: false,
        text: "",
        sessionId: threadId,
        error: classified,
        durationMs,
        isTimeout: false,
        usage: null,
      };
    }

    return {
      success: false,
      text: "",
      sessionId: threadId,
      error: "Codex가 빈 응답을 반환했습니다.",
      durationMs,
      isTimeout: false,
      usage: null,
    };
  }

  private handleError(error: unknown, stderr: string, startTime: number): RunResult {
    const durationMs = Date.now() - startTime;
    const err = typeof error === "object" && error !== null
      ? (error as { code?: string; message?: string })
      : { message: String(error) };

    if (err.code === "ENOENT") {
      return {
        success: false,
        text: "",
        sessionId: null,
        error: "Codex CLI를 찾을 수 없습니다. PATH를 확인하거나 CODEX_PATH를 설정해주세요.",
        durationMs,
        isTimeout: false,
        usage: null,
      };
    }

    const classified = this.classifyError(err.message || "", stderr);
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

  private classifyError(message: string, stderr: string): string {
    const combined = `${message}\n${stderr}`.toLowerCase();

    if (combined.includes("api_key") || combined.includes("openai_api_key")) {
      return "OpenAI API 키가 필요합니다. OPENAI_API_KEY 환경변수를 설정해주세요.";
    }

    if (combined.includes("rate limit")) {
      return "요청 한도 초과. 잠시 후 다시 시도해주세요.";
    }

    const fallback = message.trim() || stderr.trim();
    return fallback.slice(0, 500) || "알 수 없는 Codex 오류";
  }

  private extractAgentMessageText(item: CodexJsonEvent["item"]): string {
    if (!item) {
      return "";
    }

    const parts: string[] = [];
    if (item.text) {
      parts.push(item.text);
    }
    const content = item.content || [];
    for (const part of content) {
      if (part.type === "text" && part.text) {
        parts.push(part.text);
      }
    }
    return parts.join("\n").trim();
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
}
