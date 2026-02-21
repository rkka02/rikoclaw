import fs from "node:fs";
import path from "node:path";
import type { Config } from "../utils/config.js";
import { formatSkillsForPrompt, loadSkillsFromDir } from "./skill-loader.js";

const DEFAULT_MODE = "default";

const DEFAULT_HEARTBEAT = `# Heartbeat Checklist

<!-- 주기적 자율 점검 시 확인할 항목을 정의하세요 -->
<!-- 예: 정기 리서치, 알림, 진행 상황 체크 등 -->
`;

/** Legacy mode files that lived flat in personasDir before multi-mode migration. */
const LEGACY_MODE_FILES = ["HEARTBEAT.md"];

export interface ModeBinding {
  contextId: string;
  modeName: string;
  boundBy: string;
  boundAt: number;
}

export interface ModeSummary {
  name: string;
  hasHeartbeat: boolean;
}

interface BindingsMap {
  [contextId: string]: ModeBinding;
}

export class PersonaManager {
  constructor(private readonly config: Config) {
    fs.mkdirSync(this.config.personasDir, { recursive: true });
    this.migrateFlatFilesToDefault();
    this.ensureModeScaffold(DEFAULT_MODE);
  }

  close(): void {
    // noop
  }

  invalidateCache(): void {
    // No runtime cache in the current implementation.
  }

  // ── Mode listing ─────────────────────────────────────────

  listModeNames(): string[] {
    const entries = fs.readdirSync(this.config.personasDir, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "contexts")
      .map((entry) => entry.name)
      .sort();
    if (!names.includes(DEFAULT_MODE)) {
      names.unshift(DEFAULT_MODE);
    }
    return names;
  }

  listModes(): ModeSummary[] {
    return this.listModeNames().map((name) => ({
      name,
      hasHeartbeat: this.readText(this.getModeHeartbeatPath(name)).trim().length > 0,
    }));
  }

  modeExists(name: string): boolean {
    return fs.existsSync(this.getModeDir(name));
  }

  createMode(name: string): void {
    const safeName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!safeName) {
      throw new Error("Invalid mode name.");
    }
    if (this.modeExists(safeName)) {
      throw new Error(`Mode "${safeName}" already exists.`);
    }
    this.ensureModeScaffold(safeName);
  }

  deleteMode(name: string): void {
    if (name === DEFAULT_MODE) {
      throw new Error(`Cannot delete the "${DEFAULT_MODE}" mode.`);
    }
    const dir = this.getModeDir(name);
    if (!fs.existsSync(dir)) {
      throw new Error(`Mode "${name}" does not exist.`);
    }
    fs.rmSync(dir, { recursive: true, force: true });

    // Remove all bindings pointing to this mode
    const bindings = this.loadBindings();
    let changed = false;
    for (const [contextId, binding] of Object.entries(bindings)) {
      if (binding.modeName === name) {
        delete bindings[contextId];
        changed = true;
      }
    }
    if (changed) {
      this.saveBindings(bindings);
    }
  }

  // ── Bindings ─────────────────────────────────────────────

  getBinding(contextId: string): ModeBinding | null {
    const bindings = this.loadBindings();
    return bindings[contextId] ?? null;
  }

  getBoundModeName(contextId: string): string {
    const binding = this.getBinding(contextId);
    return binding?.modeName ?? DEFAULT_MODE;
  }

  bindMode(contextId: string, modeName: string, boundBy: string): void {
    if (!this.modeExists(modeName)) {
      throw new Error(`Mode "${modeName}" does not exist.`);
    }
    const bindings = this.loadBindings();
    bindings[contextId] = {
      contextId,
      modeName,
      boundBy,
      boundAt: Date.now(),
    };
    this.saveBindings(bindings);
  }

  resetBinding(contextId: string): void {
    const bindings = this.loadBindings();
    if (bindings[contextId]) {
      delete bindings[contextId];
      this.saveBindings(bindings);
    }
  }

  // ── System Prompt ────────────────────────────────────────

  buildSystemPrompt(contextId: string, modeOverride?: string): string {
    const modeName = modeOverride ?? this.getBoundModeName(contextId);
    const contextPrompt = this.readText(this.getContextPromptPath(contextId)).trim();

    const parts: string[] = [];

    // 0. Mode context + workspace
    const workspacePath = path.resolve(this.getModeWorkspaceDir(modeName));
    if (modeName !== DEFAULT_MODE) {
      parts.push(
        `<current_mode>${modeName}</current_mode>\n현재 "${modeName}" 모드로 동작 중이다. 이 모드의 지시사항과 도구에 집중하라.`,
      );
    }
    parts.push(
      `[워크스페이스]\n이 모드의 전용 워크스페이스 디렉토리: "${workspacePath}"\n노트, 리서치 결과, 중간 산출물 등을 이 디렉토리에 저장하라. 다른 모드의 워크스페이스는 건드리지 마라.`,
    );

    // 1. contexts/{contextId}.md (context override)
    if (contextPrompt) {
      parts.push(contextPrompt);
    }

    // 2. Available skills
    const skills = loadSkillsFromDir(this.config.skillsDir);
    const skillsPrompt = formatSkillsForPrompt(skills);
    if (skillsPrompt) {
      parts.push(skillsPrompt);
    }

    return parts.join("\n\n").trim();
  }

  // ── Schedules ────────────────────────────────────────────

  getScheduleFilePath(): string {
    return this.getSchedulesPath();
  }

  // ── Heartbeat ────────────────────────────────────────────

  getHeartbeatContent(): string {
    return this.readText(this.getModeHeartbeatPath(DEFAULT_MODE));
  }

  private getContextPromptPath(contextId: string): string {
    return path.join(this.config.personasDir, "contexts", `${contextId}.md`);
  }

  // ── Mode paths (per-mode) ────────────────────────────────

  getModeDir(name: string): string {
    return path.join(this.config.personasDir, name);
  }

  private getModeHeartbeatPath(modeName: string): string {
    return path.join(this.getModeDir(modeName), "HEARTBEAT.md");
  }

  getSchedulesPath(): string {
    return path.join(this.config.personasDir, "schedules.json");
  }

  getModeWorkspaceDir(modeName: string): string {
    return path.join(this.getModeDir(modeName), "workspace");
  }

  private getBindingsPath(): string {
    return path.join(this.config.personasDir, "bindings.json");
  }

  // ── Scaffold & Migration ─────────────────────────────────

  /** Ensure mode-specific files exist for the given mode. */
  private ensureModeScaffold(modeName: string): void {
    fs.mkdirSync(this.getModeWorkspaceDir(modeName), { recursive: true });
    ensureFileWithDefault(this.getModeHeartbeatPath(modeName), DEFAULT_HEARTBEAT);
  }

  private migrateFlatFilesToDefault(): void {
    const defaultDir = this.getModeDir(DEFAULT_MODE);
    if (fs.existsSync(defaultDir)) {
      // Compatibility: older builds stored schedules under default/schedules.json.
      this.moveIfMissing(path.join(defaultDir, "schedules.json"), this.getSchedulesPath());
      return;
    }

    const hasFlatFiles = LEGACY_MODE_FILES.some((file) =>
      fs.existsSync(path.join(this.config.personasDir, file)),
    );
    if (!hasFlatFiles) {
      return;
    }

    console.log("[persona-manager] migrating flat files");
    fs.mkdirSync(defaultDir, { recursive: true });

    // Mode files → default/
    for (const file of LEGACY_MODE_FILES) {
      this.moveIfMissing(
        path.join(this.config.personasDir, file),
        path.join(defaultDir, file),
      );
    }
    // Migrate legacy notes/ → workspace/
    const notesSource = path.join(this.config.personasDir, "notes");
    const workspaceDest = this.getModeWorkspaceDir(DEFAULT_MODE);
    if (fs.existsSync(notesSource) && !fs.existsSync(workspaceDest)) {
      fs.renameSync(notesSource, workspaceDest);
    }

    if (!fs.existsSync(this.getBindingsPath())) {
      this.saveBindings({});
    }

    console.log("[persona-manager] migration complete");
  }

  // ── Bindings I/O ─────────────────────────────────────────

  private loadBindings(): BindingsMap {
    const bindingsPath = this.getBindingsPath();
    if (!fs.existsSync(bindingsPath)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(bindingsPath, "utf8");
      return JSON.parse(raw) as BindingsMap;
    } catch {
      return {};
    }
  }

  private saveBindings(bindings: BindingsMap): void {
    fs.writeFileSync(this.getBindingsPath(), JSON.stringify(bindings, null, 2) + "\n", "utf8");
  }

  // ── Internal helpers ─────────────────────────────────────

  private readText(filePath: string): string {
    if (!fs.existsSync(filePath)) {
      return "";
    }
    return fs.readFileSync(filePath, "utf8");
  }

  private moveIfMissing(sourcePath: string, targetPath: string): void {
    if (!fs.existsSync(sourcePath)) {
      return;
    }
    if (fs.existsSync(targetPath)) {
      return;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.renameSync(sourcePath, targetPath);
  }

}

function ensureFileWithDefault(filePath: string, defaultContent: string): void {
  if (fs.existsSync(filePath)) {
    return;
  }
  fs.writeFileSync(filePath, defaultContent, "utf8");
}
