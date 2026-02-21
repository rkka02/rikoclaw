import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

export interface Config {
  discordToken: string;
  ownerId: string;
  allowedUserIds: Set<string>;
  allowedChannelIds: Set<string>;
  discordMessageContentIntent: boolean;
  claudePath: string;
  claudeTimeout: number;
  claudeModel: string;
  claudeMaxTurns: number | null;
  claudeDangerouslySkipPermissions: boolean;
  claudePermissionMode: string | null;
  claudeAddDirs: string[];
  dataDir: string;
  personasDir: string;
  dbPath: string;
  enableMentionResponse: boolean;
  requireMention: boolean;
  maxQueueSize: number;
  maxConcurrentRuns: number;
  claudeOutputDir: string;
  claudeInputDir: string;
  codexEnabled: boolean;
  codexPath: string;
  codexTimeout: number;
  codexModel: string;
  codexEnableSearch: boolean;
  heartbeatEnabled: boolean;
  heartbeatChannelId: string;
  heartbeatIntervalMinutes: number;
  heartbeatActiveHoursStart: number;
  heartbeatActiveHoursEnd: number;
  skillsDir: string;
  logLevel: string;
  enableLiveUpdates: boolean;
  ptyRelayEnabled: boolean;
  ptyRelayPort: number;
  ptyRelayToken: string;
  ptyRelayOrphanTimeout: number;
  ptyRelayMaxSessions: number;
  selfRestartEnabled: boolean;
  selfRestartCommand: string;
  selfRestartDelaySec: number;
  selfRestartMaxPendingMinutes: number;
  selfRestartLaunchLabel: string;
  mechoEnabled: boolean;
  mechoApiUrl: string;
  mechoTimeoutMs: number;
  mechoDefaultModeId: string;
  sessionRotationEnabled: boolean;
  sessionRotationThreshold: number;
  sessionRotationSummaryTimeout: number;
  codexDefaultContextWindow: number;
}

export function loadConfig(): Config {
  const discordToken = process.env.DISCORD_TOKEN;
  if (!discordToken) {
    throw new Error("DISCORD_TOKEN is required");
  }

  const ownerId = process.env.OWNER_ID;
  if (!ownerId) {
    throw new Error("OWNER_ID is required");
  }

  const dataDir = process.env.DATA_DIR || "./.runtime";
  const attachmentRootDir =
    process.env.DATA_DIR && process.env.DATA_DIR.trim()
      ? dataDir
      : path.join(process.cwd(), "data");
  const claudePath = resolveCliPath(process.env.CLAUDE_PATH || "claude");
  const codexPath = resolveCliPath(process.env.CODEX_PATH || "codex");

  return {
    discordToken,
    ownerId,
    allowedUserIds: parseStringSet(process.env.ALLOWED_USER_IDS),
    allowedChannelIds: parseStringSet(process.env.ALLOWED_CHANNEL_IDS),
    // Privileged intent: must also be enabled in Discord Developer Portal (Bot -> Privileged Gateway Intents).
    discordMessageContentIntent: parseBoolean(
      process.env.DISCORD_MESSAGE_CONTENT_INTENT,
      false,
    ),
    claudePath,
    claudeTimeout: parsePositiveInt(process.env.CLAUDE_TIMEOUT, 120) * 1000,
    claudeModel: process.env.CLAUDE_MODEL || "",
    claudeMaxTurns: parseOptionalMaxTurns(process.env.CLAUDE_MAX_TURNS),
    claudeDangerouslySkipPermissions: parseBoolean(
      process.env.CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS,
      false,
    ),
    claudePermissionMode: parseOptionalString(process.env.CLAUDE_PERMISSION_MODE),
    claudeAddDirs: parseStringList(process.env.CLAUDE_ADD_DIRS),
    dataDir,
    personasDir: process.env.PERSONAS_DIR || path.join(dataDir, "personas"),
    dbPath: process.env.DB_PATH || path.join(dataDir, "sessions.db"),
    enableMentionResponse: parseBoolean(process.env.ENABLE_MENTION_RESPONSE, true),
    requireMention: parseBoolean(process.env.REQUIRE_MENTION, true),
    maxQueueSize: parsePositiveInt(process.env.MAX_QUEUE_SIZE, 10),
    maxConcurrentRuns: parsePositiveInt(process.env.MAX_CONCURRENT_RUNS, 1),
    claudeOutputDir:
      process.env.CLAUDE_OUTPUT_DIR || path.join(attachmentRootDir, "output"),
    claudeInputDir:
      process.env.CLAUDE_INPUT_DIR || path.join(attachmentRootDir, "input"),
    codexEnabled: parseBoolean(process.env.CODEX_ENABLED, false),
    codexPath,
    codexTimeout: parsePositiveInt(process.env.CODEX_TIMEOUT, 120) * 1000,
    codexModel: process.env.CODEX_MODEL || "",
    codexEnableSearch: parseBoolean(process.env.CODEX_ENABLE_SEARCH, false),
    heartbeatEnabled: parseBoolean(process.env.HEARTBEAT_ENABLED, false),
    heartbeatChannelId: process.env.HEARTBEAT_CHANNEL_ID || "",
    heartbeatIntervalMinutes: parsePositiveInt(process.env.HEARTBEAT_INTERVAL_MINUTES, 30),
    heartbeatActiveHoursStart: parsePositiveInt(process.env.HEARTBEAT_ACTIVE_HOURS_START, 0),
    heartbeatActiveHoursEnd: parsePositiveInt(process.env.HEARTBEAT_ACTIVE_HOURS_END, 24),
    skillsDir: process.env.SKILLS_DIR || path.join(process.cwd(), "skills"),
    logLevel: process.env.LOG_LEVEL || "info",
    enableLiveUpdates: parseBoolean(process.env.ENABLE_LIVE_UPDATES, true),
    ptyRelayEnabled: parseBoolean(process.env.PTY_RELAY_ENABLED, false),
    // 7680 is commonly used by Windows Delivery Optimization; avoid it as a default.
    ptyRelayPort: parsePositiveInt(process.env.PTY_RELAY_PORT, 7681),
    ptyRelayToken: process.env.PTY_RELAY_TOKEN || "",
    ptyRelayOrphanTimeout: parsePositiveInt(process.env.PTY_RELAY_ORPHAN_TIMEOUT, 1800),
    ptyRelayMaxSessions: parsePositiveInt(process.env.PTY_RELAY_MAX_SESSIONS, 5),
    selfRestartEnabled: parseBoolean(process.env.SELF_RESTART_ENABLED, false),
    selfRestartCommand: (
      process.env.SELF_RESTART_COMMAND
      || `cd "${process.cwd()}" && npm start`
    ).trim(),
    selfRestartDelaySec: parsePositiveInt(process.env.SELF_RESTART_DELAY_SEC, 3),
    selfRestartMaxPendingMinutes: parsePositiveInt(
      process.env.SELF_RESTART_MAX_PENDING_MINUTES,
      60,
    ),
    selfRestartLaunchLabel: (
      process.env.SELF_RESTART_LAUNCH_LABEL
      || "com.zerotwo_claw.self-restart"
    ).trim(),
    mechoEnabled: parseBoolean(process.env.MECHO_ENABLED, false),
    mechoApiUrl: (process.env.MECHO_API_URL || "http://127.0.0.1:3100").trim(),
    mechoTimeoutMs: parsePositiveInt(process.env.MECHO_TIMEOUT_MS, 3000),
    mechoDefaultModeId: (
      process.env.MECHO_DEFAULT_MODE_ID
      || "default"
    ).trim(),
    sessionRotationEnabled: parseBoolean(process.env.SESSION_ROTATION_ENABLED, true),
    sessionRotationThreshold: parseFloatClamped(process.env.SESSION_ROTATION_THRESHOLD, 0.8, 0.5, 0.95),
    sessionRotationSummaryTimeout: parsePositiveInt(process.env.SESSION_ROTATION_SUMMARY_TIMEOUT, 60) * 1000,
    codexDefaultContextWindow: parsePositiveInt(process.env.CODEX_DEFAULT_CONTEXT_WINDOW, 200000),
  };
}

function resolveCliPath(value: string): string {
  const clean = value.trim();
  if (!clean) {
    return value;
  }

  // Treat any path-ish value as authoritative.
  const looksLikePath =
    clean.includes("\\") ||
    clean.includes("/") ||
    /^[A-Za-z]:[\\/]/.test(clean);
  if (looksLikePath) {
    return clean;
  }

  if (process.platform !== "win32") {
    return clean;
  }

  // Prefer the vendor-provided `codex.exe` on Windows when Codex is installed globally via npm.
  // Spawning `*.cmd` shims directly does not work reliably with `child_process.spawn` without `shell: true`.
  const codexExe = resolveCodexVendorExeWindows(clean);
  if (codexExe) {
    return codexExe;
  }

  // If already resolvable via PATH, keep it (don't override user PATH precedence).
  const onPath = resolveOnWindowsPath(clean);
  if (onPath) {
    return onPath;
  }

  // Common global npm bin locations on Windows.
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  const candidates: string[] = [];
  if (appData) {
    candidates.push(...resolveWindowsBinCandidates(path.join(appData, "npm"), clean));
  }
  if (localAppData) {
    candidates.push(...resolveWindowsBinCandidates(path.join(localAppData, "npm"), clean));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return clean;
}

function resolveCodexVendorExeWindows(command: string): string | null {
  const normalized = command.trim().toLowerCase();
  const base = normalized.replace(/\.(exe|cmd|ps1)$/, "");
  if (base !== "codex") {
    return null;
  }

  const triplet =
    process.arch === "arm64"
      ? "aarch64-pc-windows-msvc"
      : process.arch === "x64"
        ? "x86_64-pc-windows-msvc"
        : null;
  if (!triplet) {
    return null;
  }

  const roots: string[] = [];
  if (process.env.APPDATA) {
    roots.push(path.join(process.env.APPDATA, "npm"));
  }
  if (process.env.LOCALAPPDATA) {
    roots.push(path.join(process.env.LOCALAPPDATA, "npm"));
  }

  for (const root of roots) {
    const exePath = path.join(
      root,
      "node_modules",
      "@openai",
      "codex",
      "vendor",
      triplet,
      "codex",
      "codex.exe",
    );
    if (fs.existsSync(exePath)) {
      return exePath;
    }
  }

  return null;
}

function resolveOnWindowsPath(command: string): string | null {
  const pathEnv = process.env.PATH || "";
  const pathParts = pathEnv.split(";").map((p) => p.trim()).filter(Boolean);
  const pathextEnv = process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM";
  const exts = pathextEnv.split(";").map((e) => e.trim()).filter(Boolean);

  // If the command already has an extension, prefer it as-is.
  const hasExt = /\.[A-Za-z0-9]+$/.test(command);
  const names = hasExt ? [command] : exts.map((ext) => `${command}${ext.toLowerCase()}`);

  for (const dir of pathParts) {
    for (const name of names) {
      const fullPath = path.join(dir, name);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

function resolveWindowsBinCandidates(baseDir: string, command: string): string[] {
  const pathextEnv = process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM";
  const exts = pathextEnv.split(";").map((e) => e.trim()).filter(Boolean);
  const hasExt = /\.[A-Za-z0-9]+$/.test(command);
  if (hasExt) {
    return [path.join(baseDir, command)];
  }
  return exts.map((ext) => path.join(baseDir, `${command}${ext.toLowerCase()}`));
}

function parseStringSet(value: string | undefined): Set<string> {
  if (!value?.trim()) {
    return new Set<string>();
  }

  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return new Set(items);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseOptionalMaxTurns(value: string | undefined): number | null {
  if (!value || !value.trim()) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseOptionalString(value: string | undefined): string | null {
  if (!value || !value.trim()) {
    return null;
  }
  return value.trim();
}

function parseStringList(value: string | undefined): string[] {
  if (!value || !value.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseFloatClamped(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  return fallback;
}
