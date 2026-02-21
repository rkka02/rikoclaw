import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "../utils/config.js";
import type { EngineType } from "./llm-runner.js";

export const RESTART_DIRECTIVE_FILE_NAME = ".rikoclaw-restart.json";

const RESTART_PENDING_FILE_NAME = "restart-pending.json";
const RESTART_PENDING_VERSION = 1;
const RESTART_NOTICE = "서버 재시작되었고, 수정한 코드 전부 반영되었음.";

export interface RestartDirective {
  reason: string;
  resumePrompt: string;
  delaySec: number | null;
}

export interface RestartScheduleInput {
  channelId: string;
  userId: string;
  contextId: string;
  sessionUserId: string;
  engine: EngineType;
  sessionId: string | null;
  model: string | null;
  modeName: string | null;
  mechoModeId: string | null;
  reason: string;
  resumePrompt: string;
  delaySec: number | null;
}

export interface PendingRestartResume {
  id: string;
  requestedAt: number;
  channelId: string;
  userId: string;
  contextId: string;
  sessionUserId: string;
  engine: EngineType;
  sessionId: string | null;
  model: string | null;
  modeName: string | null;
  mechoModeId: string | null;
  reason: string;
  resumePrompt: string;
}

export interface RestartScheduleResult {
  status: "scheduled" | "disabled" | "error";
  message: string;
}

interface PersistedRestartState {
  version: number;
  pending: PendingRestartResume;
}

interface ParsedDirective {
  directive: RestartDirective;
  hasRestartSignal: boolean;
}

export class RestartManager {
  constructor(private readonly config: Config) {}

  getDirectivePath(outputDir: string): string {
    return path.join(outputDir, RESTART_DIRECTIVE_FILE_NAME);
  }

  readDirective(outputDir: string): {
    directive: RestartDirective | null;
    error: string | null;
    consumedFileNames: string[];
  } {
    const filePath = this.getDirectivePath(outputDir);
    if (!fs.existsSync(filePath)) {
      return this.readDirectiveFromJsonFiles(outputDir);
    }

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (error: unknown) {
      return {
        directive: null,
        error: `재시작 지시 파일 읽기 실패 (${String(error)})`,
        consumedFileNames: [RESTART_DIRECTIVE_FILE_NAME],
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error: unknown) {
      return {
        directive: null,
        error: `재시작 지시 파일 JSON 파싱 실패 (${String(error)})`,
        consumedFileNames: [RESTART_DIRECTIVE_FILE_NAME],
      };
    }

    if (!isRecord(parsed)) {
      return {
        directive: null,
        error: "재시작 지시 파일 형식이 올바르지 않습니다 (object 필요).",
        consumedFileNames: [RESTART_DIRECTIVE_FILE_NAME],
      };
    }

    const parsedDirective = parseDirectiveRecord(parsed);
    if (!parsedDirective) {
      return {
        directive: null,
        error: "재시작 지시 파일에 유효한 restart 신호가 없습니다.",
        consumedFileNames: [RESTART_DIRECTIVE_FILE_NAME],
      };
    }

    return {
      directive: parsedDirective.directive,
      error: null,
      consumedFileNames: [RESTART_DIRECTIVE_FILE_NAME],
    };
  }

  readDirectiveFromText(text: string): RestartDirective | null {
    if (!text.trim()) {
      return null;
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      if (!isRecord(parsed)) {
        return null;
      }
      const parsedDirective = parseDirectiveRecord(parsed);
      if (!parsedDirective || !parsedDirective.hasRestartSignal) {
        return null;
      }
      return parsedDirective.directive;
    } catch {
      return null;
    }
  }

  scheduleRestart(input: RestartScheduleInput): RestartScheduleResult {
    if (!this.config.selfRestartEnabled) {
      return {
        status: "disabled",
        message: "SELF_RESTART_ENABLED=false 이므로 자동 재시작을 건너뜁니다.",
      };
    }

    if (process.platform !== "darwin") {
      return {
        status: "error",
        message: "자동 재시작은 macOS(launchctl)에서만 지원됩니다.",
      };
    }

    const restartCommand = this.config.selfRestartCommand.trim();
    if (!restartCommand) {
      return {
        status: "error",
        message: "SELF_RESTART_COMMAND가 비어 있어 재시작을 예약할 수 없습니다.",
      };
    }

    const requestedAt = Date.now();
    const delaySec = clampInt(input.delaySec ?? this.config.selfRestartDelaySec, 1, 600);
    const pending: PendingRestartResume = {
      id: `restart_${requestedAt}_${Math.floor(Math.random() * 1000000)}`,
      requestedAt,
      channelId: input.channelId,
      userId: input.userId,
      contextId: input.contextId,
      sessionUserId: input.sessionUserId,
      engine: input.engine,
      sessionId: input.sessionId,
      model: input.model,
      modeName: input.modeName,
      mechoModeId: input.mechoModeId,
      reason: input.reason.trim(),
      resumePrompt: buildResumePrompt(input.reason, input.resumePrompt),
    };

    try {
      this.writePendingResume(pending);
    } catch (error: unknown) {
      return {
        status: "error",
        message: `재개 상태 저장 실패 (${String(error)})`,
      };
    }

    const launchLabelBase = sanitizeLaunchLabel(this.config.selfRestartLaunchLabel);
    const launchLabel = `${launchLabelBase}.${process.pid}.${requestedAt}`;
    const inheritedEnv = buildInheritedEnvPrefix();
    const shellCommand = `${inheritedEnv}sleep ${delaySec}; ${restartCommand}`;
    const result = spawnSync(
      "launchctl",
      ["submit", "-l", launchLabel, "--", "/bin/zsh", "-lc", shellCommand],
      { encoding: "utf8" },
    );

    if (result.error || result.status !== 0) {
      this.clearPendingResume();
      const stderr = (result.stderr || "").trim();
      const reason = result.error ? String(result.error) : stderr || `exit=${result.status}`;
      return {
        status: "error",
        message: `launchctl 재시작 예약 실패 (${reason})`,
      };
    }

    return {
      status: "scheduled",
      message: `재시작 예약됨 (delay=${delaySec}s, label=${launchLabel})`,
    };
  }

  peekPendingResume(): PendingRestartResume | null {
    const filePath = this.getPendingPath();
    if (!fs.existsSync(filePath)) {
      return null;
    }

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      this.clearPendingResume();
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.clearPendingResume();
      return null;
    }

    const state = parsePersistedState(parsed);
    if (!state) {
      this.clearPendingResume();
      return null;
    }

    const maxAgeMs = this.config.selfRestartMaxPendingMinutes * 60_000;
    if (Date.now() - state.pending.requestedAt > maxAgeMs) {
      this.clearPendingResume();
      return null;
    }

    return state.pending;
  }

  clearPendingResume(): void {
    try {
      fs.unlinkSync(this.getPendingPath());
    } catch (error: unknown) {
      const nodeError = error as { code?: string };
      if (nodeError.code !== "ENOENT") {
        console.error("[restart] pending state cleanup failed:", error);
      }
    }
  }

  private writePendingResume(pending: PendingRestartResume): void {
    const state: PersistedRestartState = {
      version: RESTART_PENDING_VERSION,
      pending,
    };

    const filePath = this.getPendingPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, filePath);
  }

  private getPendingPath(): string {
    return path.join(this.config.dataDir, RESTART_PENDING_FILE_NAME);
  }

  private readDirectiveFromJsonFiles(outputDir: string): {
    directive: RestartDirective | null;
    error: string | null;
    consumedFileNames: string[];
  } {
    let entries: string[];
    try {
      entries = fs
        .readdirSync(outputDir)
        .filter((entry) => entry.toLowerCase().endsWith(".json"))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return {
        directive: null,
        error: null,
        consumedFileNames: [],
      };
    }

    for (const entry of entries) {
      const filePath = path.join(outputDir, entry);
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      if (!isRecord(parsed)) {
        continue;
      }

      const parsedDirective = parseDirectiveRecord(parsed);
      if (!parsedDirective || !parsedDirective.hasRestartSignal) {
        continue;
      }

      return {
        directive: parsedDirective.directive,
        error: null,
        consumedFileNames: [entry],
      };
    }

    return {
      directive: null,
      error: null,
      consumedFileNames: [],
    };
  }
}

function buildResumePrompt(reason: string, requestedPrompt: string): string {
  const base = requestedPrompt.trim();
  if (base.includes(RESTART_NOTICE)) {
    return base;
  }

  const reasonLine = reason.trim() ? `재시작 사유: ${reason.trim()}` : "재시작 사유: 코드 반영";
  if (!base) {
    return [
      RESTART_NOTICE,
      reasonLine,
      "이전 세션을 재개해서 직전 작업을 이어서 완료하고 결과를 보고하라.",
    ].join("\n");
  }

  return [RESTART_NOTICE, reasonLine, "", base].join("\n");
}

function parsePersistedState(value: unknown): PersistedRestartState | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.version !== RESTART_PENDING_VERSION) {
    return null;
  }
  const pending = parsePending(value.pending);
  if (!pending) {
    return null;
  }
  return {
    version: RESTART_PENDING_VERSION,
    pending,
  };
}

function parsePending(value: unknown): PendingRestartResume | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = asNonEmptyString(value.id);
  const requestedAt = asPositiveInt(value.requestedAt);
  const channelId = asNonEmptyString(value.channelId);
  const userId = asNonEmptyString(value.userId);
  const contextId = asNonEmptyString(value.contextId);
  const sessionUserId = asNonEmptyString(value.sessionUserId);
  const engine = asEngine(value.engine);
  if (!id || !requestedAt || !channelId || !userId || !contextId || !sessionUserId || !engine) {
    return null;
  }

  return {
    id,
    requestedAt,
    channelId,
    userId,
    contextId,
    sessionUserId,
    engine,
    sessionId: asNullableString(value.sessionId),
    model: asNullableString(value.model),
    modeName: asNullableString(value.modeName),
    mechoModeId: asNullableString(value.mechoModeId),
    reason: asNullableString(value.reason) || "",
    resumePrompt: asNonEmptyString(value.resumePrompt)
      || `${RESTART_NOTICE}\n이전 세션을 재개해서 직전 작업을 이어서 완료하고 결과를 보고하라.`,
  };
}

function parseDirectiveRecord(parsed: Record<string, unknown>): ParsedDirective | null {
  const reason = firstString(
    parsed.reason,
    parsed.restartReason,
    parsed.restart_reason,
    "",
  ).trim();
  const resumePrompt = firstString(
    parsed.resumePrompt,
    parsed.resume_prompt,
    parsed.prompt,
    "",
  ).trim();
  const delaySec = firstPositiveInt(
    parsed.delaySec,
    parsed.delay_sec,
    parsed.delaySeconds,
    parsed.delay_seconds,
  );
  const restartFlag = firstBoolean(
    parsed.restart,
    parsed.restartRequired,
    parsed.restart_required,
    parsed.selfRestart,
    parsed.self_restart,
    parsed.applyAndRestart,
    parsed.apply_and_restart,
  );

  const hasRestartSignal = Boolean(
    restartFlag
    || resumePrompt
    || reason
    || delaySec,
  );
  if (!hasRestartSignal) {
    return null;
  }

  return {
    directive: {
      reason,
      resumePrompt,
      delaySec,
    },
    hasRestartSignal,
  };
}

function asEngine(value: unknown): EngineType | null {
  if (value === "claude" || value === "codex") {
    return value;
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function firstPositiveInt(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      const parsed = Math.floor(value);
      if (parsed > 0) {
        return parsed;
      }
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseInt(value.trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return null;
}

function firstBoolean(...values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes") {
        return true;
      }
      if (normalized === "false" || normalized === "0" || normalized === "no") {
        return false;
      }
    }
  }
  return false;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function sanitizeLaunchLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "com.rikoclaw.self-restart";
  }
  const normalized = trimmed
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "com.rikoclaw.self-restart";
}

function buildInheritedEnvPrefix(): string {
  const keys = [
    "PATH",
    "HOME",
    "USER",
    "SHELL",
    "NVM_DIR",
    "NVM_BIN",
    "PNPM_HOME",
    "BUN_INSTALL",
    "VOLTA_HOME",
    "ASDF_DIR",
    "MISE_DATA_DIR",
  ];

  const exports: string[] = [];
  for (const key of keys) {
    const raw = process.env[key];
    if (!raw || !raw.trim()) {
      continue;
    }
    exports.push(`export ${key}=${shellQuote(raw)};`);
  }

  return exports.length > 0 ? `${exports.join(" ")} ` : "";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
