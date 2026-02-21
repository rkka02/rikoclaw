export type EngineType = "claude" | "codex";

export type RunEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "tool_use"; toolUseId?: string; name: string; input: unknown }
  | {
      type: "tool_result";
      toolUseId?: string;
      name?: string;
      stdout?: string;
      stderr?: string;
      stdoutLen?: number;
      stderrLen?: number;
      interrupted?: boolean;
      isError?: boolean;
    }
  | { type: "status"; message: string };

export interface UsageInfo {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  contextWindow: number | null;
  totalContextTokens: number;
}

export interface RunOptions {
  prompt: string;
  sessionId?: string;
  systemPrompt?: string;
  model?: string;
  maxTurns?: number | null;
  onEvent?: (event: RunEvent) => void;
  onAbortReady?: (abort: () => void) => void;
  envOverrides?: Record<string, string>;
}

export interface RunResult {
  success: boolean;
  text: string;
  sessionId: string | null;
  error: string | null;
  durationMs: number;
  isTimeout: boolean;
  usage: UsageInfo | null;
}

export interface LLMRunner {
  readonly engineName: EngineType;
  readonly supportsMaxTurnsRetry: boolean;
  readonly supportsSessionResume: boolean;
  run(options: RunOptions): Promise<RunResult>;
  cancelCurrentRun(): boolean;
}
