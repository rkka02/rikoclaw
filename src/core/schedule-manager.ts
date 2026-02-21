import fs from "node:fs";
import path from "node:path";
import type { Client, TextBasedChannel } from "discord.js";
import { PersonaManager } from "./persona-manager.js";
import { QueueManager } from "./queue-manager.js";
import { SessionManager } from "./session-manager.js";

interface ScheduleDefinition {
  id: string;
  cron: string;
  channelId: string;
  prompt: string;
  modeId?: string;
  enabled?: boolean;
  modeName?: string;
  model?: string;
}

interface CronField {
  values: Set<number>;
  wildcard: boolean;
}

interface CronExpression {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

interface CronDateTime {
  year: number;
  month: number;
  dayOfMonth: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
}

interface ScheduleSource {
  filePath: string;
  keyPrefix: string | null;
  defaultModeName: string;
  sourceLabel: string;
}

interface LoadedSchedule {
  id: string;
  key: string;
  modeName: string;
  cron: string;
  cronExpr: CronExpression;
  channelId: string;
  prompt: string;
  modeId: string | null;
  model: string | null;
  enabled: boolean;
  sourcePath: string;
  sourceLabel: string;
}

export interface ScheduleListItem {
  id: string;
  key: string;
  modeName: string;
  cron: string;
  channelId: string;
  modeId: string | null;
  model: string | null;
  enabled: boolean;
  source: string;
}

export interface AddScheduleInput {
  id: string;
  cron: string;
  channelId: string;
  prompt: string;
  modeId?: string;
  enabled?: boolean;
  modeName?: string;
  model?: string;
}

export interface ScheduleMutationResult {
  ok: boolean;
  error?: "not_found" | "ambiguous" | "invalid" | "duplicate";
  message: string;
  item?: ScheduleListItem;
  candidates?: string[];
}

export type ToggleScheduleResult = ScheduleMutationResult;

export class ScheduleManager {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly firedScheduleKeys = new Set<string>();
  private activeMinuteBucket = "";

  constructor(
    private readonly client: Client,
    private readonly personas: PersonaManager,
    private readonly queue: QueueManager,
    private readonly sessions: SessionManager,
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }

    void this.runTickSafely();
    this.timer = setInterval(() => {
      void this.runTickSafely();
    }, 60_000);
    // Don't keep the Node event loop alive if nothing else is running.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.firedScheduleKeys.clear();
    this.activeMinuteBucket = "";
  }

  listSchedules(): ScheduleListItem[] {
    return this.loadSchedules().map((item) => this.toListItem(item));
  }

  addSchedule(input: AddScheduleInput): ScheduleMutationResult {
    const id = input.id.trim();
    const cron = input.cron.trim();
    const channelId = input.channelId.trim();
    const prompt = input.prompt.trim();
    const modeIdRaw = (input.modeId || "").trim();
    const modeId = normalizeModeId(modeIdRaw);
    const modeName = (input.modeName || "").trim();
    const model = (input.model || "").trim() || undefined;
    const enabled = input.enabled !== false;

    if (!id) {
      return {
        ok: false,
        error: "invalid",
        message: "id is required.",
      };
    }
    if (!cron) {
      return {
        ok: false,
        error: "invalid",
        message: "cron is required.",
      };
    }
    if (!channelId) {
      return {
        ok: false,
        error: "invalid",
        message: "channelId is required.",
      };
    }
    if (!prompt) {
      return {
        ok: false,
        error: "invalid",
        message: "prompt is required.",
      };
    }
    if (modeIdRaw && !modeId) {
      return {
        ok: false,
        error: "invalid",
        message: "modeId is invalid. Use letters, numbers, underscore, hyphen.",
      };
    }

    try {
      parseCron(cron);
    } catch (error: unknown) {
      return {
        ok: false,
        error: "invalid",
        message: `Invalid cron: ${String(error)}`,
      };
    }

    if (modeName && !this.personas.modeExists(modeName)) {
      return {
        ok: false,
        error: "invalid",
        message: `Unknown mode: ${modeName}`,
      };
    }

    const all = this.loadSchedules();
    const conflict = all.filter((item) => item.id === id || item.key === id);
    if (conflict.length > 0) {
      const candidates = conflict.map((item) => item.key);
      return {
        ok: false,
        error: "duplicate",
        message: `Schedule id already exists: ${id}`,
        candidates,
      };
    }

    const sourcePath = this.personas.getScheduleFilePath();
    const readResult = this.readSourceDefinitions(sourcePath, true);
    if (!("definitions" in readResult)) {
      return readResult;
    }

    const definitions = readResult.definitions;
    const next: ScheduleDefinition = {
      id,
      cron,
      channelId,
      prompt,
      ...(modeId ? { modeId } : {}),
      enabled,
      ...(modeName ? { modeName } : {}),
      ...(model ? { model } : {}),
    };

    definitions.push(next);
    const writeResult = this.writeSourceDefinitions(sourcePath, definitions);
    if (!writeResult.ok) {
      return writeResult;
    }

    const created: ScheduleListItem = {
      id,
      key: id,
      modeName: modeName || "default",
      cron,
      channelId,
      modeId: modeId || null,
      model: model || null,
      enabled,
      source: "root",
    };

    return {
      ok: true,
      message: `Added schedule: ${created.key}`,
      item: created,
    };
  }

  removeSchedule(idOrKey: string): ScheduleMutationResult {
    const all = this.loadSchedules();
    const target = this.resolveSchedule(all, idOrKey);
    if (!target) {
      return {
        ok: false,
        error: "not_found",
        message: `Schedule not found: ${idOrKey}`,
      };
    }

    if (Array.isArray(target)) {
      return {
        ok: false,
        error: "ambiguous",
        message: `Multiple schedules share id "${idOrKey}". Use one of the keys.`,
        candidates: target.map((item) => item.key),
      };
    }

    const readResult = this.readSourceDefinitions(target.sourcePath, false);
    if (!("definitions" in readResult)) {
      return readResult;
    }

    const definitions = readResult.definitions;
    const index = this.findDefinitionIndex(definitions, target);
    if (index < 0) {
      return {
        ok: false,
        error: "not_found",
        message: `Schedule id "${target.id}" not found in source file.`,
      };
    }

    definitions.splice(index, 1);
    const writeResult = this.writeSourceDefinitions(target.sourcePath, definitions);
    if (!writeResult.ok) {
      return writeResult;
    }

    this.firedScheduleKeys.delete(target.key);

    return {
      ok: true,
      message: `Removed schedule: ${target.key}`,
      item: this.toListItem(target),
    };
  }

  toggleSchedule(idOrKey: string): ToggleScheduleResult {
    const all = this.loadSchedules();
    const target = this.resolveSchedule(all, idOrKey);
    if (!target) {
      return {
        ok: false,
        error: "not_found",
        message: `Schedule not found: ${idOrKey}`,
      };
    }

    if (Array.isArray(target)) {
      return {
        ok: false,
        error: "ambiguous",
        message: `Multiple schedules share id "${idOrKey}". Use one of the keys.`,
        candidates: target.map((item) => item.key),
      };
    }

    const readResult = this.readSourceDefinitions(target.sourcePath, false);
    if (!("definitions" in readResult)) {
      return readResult;
    }

    const definitions = readResult.definitions;
    const index = this.findDefinitionIndex(definitions, target);
    if (index < 0) {
      return {
        ok: false,
        error: "not_found",
        message: `Schedule id "${target.id}" not found in source file.`,
      };
    }

    const currentEnabled = definitions[index]?.enabled !== false;
    definitions[index] = {
      ...definitions[index],
      enabled: !currentEnabled,
    };

    const writeResult = this.writeSourceDefinitions(target.sourcePath, definitions);
    if (!writeResult.ok) {
      return writeResult;
    }

    const updated: ScheduleListItem = {
      ...this.toListItem(target),
      enabled: !currentEnabled,
    };

    return {
      ok: true,
      message: `${updated.key} is now ${updated.enabled ? "enabled" : "disabled"}.`,
      item: updated,
    };
  }

  async runScheduleNow(idOrKey: string): Promise<ScheduleMutationResult> {
    const all = this.loadSchedules();
    const target = this.resolveSchedule(all, idOrKey);
    if (!target) {
      return {
        ok: false,
        error: "not_found",
        message: `Schedule not found: ${idOrKey}`,
      };
    }

    if (Array.isArray(target)) {
      return {
        ok: false,
        error: "ambiguous",
        message: `Multiple schedules share id "${idOrKey}". Use one of the keys.`,
        candidates: target.map((item) => item.key),
      };
    }

    const runResult = await this.enqueueSchedule(target);
    if (!runResult.ok) {
      return runResult;
    }

    return {
      ok: true,
      message: `Manually queued: ${target.key}`,
      item: this.toListItem(target),
    };
  }

  private resolveSchedule(
    schedules: LoadedSchedule[],
    idOrKey: string,
  ): LoadedSchedule | LoadedSchedule[] | null {
    const direct = schedules.find((item) => item.key === idOrKey);
    if (direct) {
      return direct;
    }
    return this.resolveById(schedules, idOrKey);
  }

  private resolveById(
    schedules: LoadedSchedule[],
    id: string,
  ): LoadedSchedule | LoadedSchedule[] | null {
    const matches = schedules.filter((item) => item.id === id);
    if (matches.length === 0) {
      return null;
    }
    if (matches.length === 1) {
      return matches[0]!;
    }
    return matches;
  }

  private async tick(now: Date = new Date()): Promise<void> {
    const cronNow = getCronDateTime(now);
    const bucket = toMinuteBucket(cronNow);
    if (bucket !== this.activeMinuteBucket) {
      this.activeMinuteBucket = bucket;
      this.firedScheduleKeys.clear();
    }

    for (const schedule of this.loadSchedules()) {
      if (!schedule.enabled) {
        continue;
      }
      if (!matchesCron(schedule.cronExpr, cronNow)) {
        continue;
      }
      if (this.firedScheduleKeys.has(schedule.key)) {
        continue;
      }

      const result = await this.enqueueSchedule(schedule);
      if (result.ok) {
        this.firedScheduleKeys.add(schedule.key);
      }
    }
  }

  private async runTickSafely(now: Date = new Date()): Promise<void> {
    if (this.ticking) {
      console.warn("[schedule] tick skipped because a previous tick is still running");
      return;
    }
    this.ticking = true;
    try {
      await this.tick(now);
    } catch (error: unknown) {
      console.error("[schedule] tick failed:", error);
    } finally {
      this.ticking = false;
    }
  }

  private async enqueueSchedule(schedule: LoadedSchedule): Promise<ScheduleMutationResult> {
    const taskKey = `schedule:${schedule.key}:${schedule.channelId}`;
    if (this.queue.hasTask(taskKey)) {
      return {
        ok: false,
        error: "invalid",
        message: `Schedule already queued: ${schedule.key}`,
      };
    }

    const channel = await this.resolveTextChannel(schedule.channelId);
    if (!channel) {
      console.warn(
        `[schedule] skipped key=${schedule.key} because channel ${schedule.channelId} is unavailable`,
      );
      return {
        ok: false,
        error: "invalid",
        message: `Channel unavailable: ${schedule.channelId}`,
      };
    }

    const contextId = `ch_${channel.id}`;
    const scheduleUserId = schedule.modeId
      ? `mode:${schedule.modeId}`
      : `schedule:${schedule.key}`;
    const sessionId = this.sessions.getSession(scheduleUserId, contextId, "claude");

    const result = this.queue.enqueue({
      prompt: schedule.prompt,
      sessionId,
      sessionUserId: scheduleUserId,
      mechoModeId: schedule.modeId,
      model: schedule.model ?? null,
      taskKey,
      respondTo: { type: "channel", channel },
      createdAt: Date.now(),
      engine: "claude",
      modeName: schedule.modeName,
    });

    if (!result.accepted) {
      return {
        ok: false,
        error: "invalid",
        message: `Failed to enqueue schedule: ${schedule.key} (${result.reason})`,
      };
    }

    console.log(`[schedule] enqueued key=${schedule.key} channel=${schedule.channelId}`);
    return {
      ok: true,
      message: `Queued schedule: ${schedule.key}`,
      item: this.toListItem(schedule),
    };
  }

  private listScheduleSources(): ScheduleSource[] {
    const byPath = new Map<string, ScheduleSource>();

    const primaryPath = path.resolve(this.personas.getScheduleFilePath());
    byPath.set(primaryPath, {
      filePath: primaryPath,
      keyPrefix: null,
      defaultModeName: "default",
      sourceLabel: "root",
    });

    for (const modeName of this.personas.listModeNames()) {
      const modePath = path.resolve(path.join(this.personas.getModeDir(modeName), "schedules.json"));
      if (modePath === primaryPath) {
        continue;
      }
      if (!fs.existsSync(modePath)) {
        continue;
      }

      byPath.set(modePath, {
        filePath: modePath,
        keyPrefix: modeName,
        defaultModeName: modeName,
        sourceLabel: `mode:${modeName}`,
      });
    }

    return Array.from(byPath.values());
  }

  private loadSchedules(): LoadedSchedule[] {
    const schedules: LoadedSchedule[] = [];

    for (const source of this.listScheduleSources()) {
      const readResult = this.readSourceDefinitions(source.filePath, false);
      if (!("definitions" in readResult)) {
        continue;
      }

      for (const entry of readResult.definitions) {
        const item = toScheduleDefinition(entry);
        if (!item) {
          continue;
        }

        let cronExpr: CronExpression;
        try {
          cronExpr = parseCron(item.cron);
        } catch (error: unknown) {
          console.warn(
            `[schedule] invalid cron "${item.cron}" in ${source.filePath}: ${String(error)}`,
          );
          continue;
        }

        const modeName = item.modeName || source.defaultModeName;
        const key = source.keyPrefix ? `${source.keyPrefix}:${item.id}` : item.id;

        schedules.push({
          id: item.id,
          key,
          modeName,
          cron: item.cron,
          cronExpr,
          channelId: item.channelId,
          prompt: item.prompt,
          modeId: item.modeId || null,
          model: item.model || null,
          enabled: item.enabled !== false,
          sourcePath: source.filePath,
          sourceLabel: source.sourceLabel,
        });
      }
    }

    return schedules.sort((a, b) => a.key.localeCompare(b.key));
  }

  private readSourceDefinitions(
    filePath: string,
    createIfMissing: boolean,
  ):
    | { ok: true; definitions: ScheduleDefinition[] }
    | ScheduleMutationResult {
    if (!fs.existsSync(filePath)) {
      if (createIfMissing) {
        return { ok: true, definitions: [] };
      }
      return {
        ok: false,
        error: "not_found",
        message: `Schedule file not found: ${filePath}`,
      };
    }

    const text = fs.readFileSync(filePath, "utf8");
    if (!text.trim()) {
      return { ok: true, definitions: [] };
    }

    let parsed: unknown;
    try {
      parsed = parseJsonWithComments(text);
    } catch (error: unknown) {
      return {
        ok: false,
        error: "invalid",
        message: `Invalid schedule file: ${filePath} (${String(error)})`,
      };
    }

    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        error: "invalid",
        message: `Invalid schedule file: ${filePath} (must be an array)`,
      };
    }

    return {
      ok: true,
      definitions: parsed as ScheduleDefinition[],
    };
  }

  private writeSourceDefinitions(
    filePath: string,
    definitions: ScheduleDefinition[],
  ): ScheduleMutationResult | { ok: true } {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(definitions, null, 2)}\n`, "utf8");
      return { ok: true };
    } catch (error: unknown) {
      return {
        ok: false,
        error: "invalid",
        message: `Failed to write schedule file: ${filePath} (${String(error)})`,
      };
    }
  }

  private findDefinitionIndex(definitions: ScheduleDefinition[], target: LoadedSchedule): number {
    const byShape = definitions.findIndex((definition) => {
      const parsed = toScheduleDefinition(definition);
      if (!parsed) {
        return false;
      }
      const modeName = parsed.modeName || "default";
      const modeId = parsed.modeId || null;
      return (
        parsed.id === target.id &&
        parsed.cron === target.cron &&
        parsed.channelId === target.channelId &&
        parsed.prompt === target.prompt &&
        modeId === target.modeId &&
        modeName === target.modeName
      );
    });

    if (byShape >= 0) {
      return byShape;
    }

    return definitions.findIndex((definition) => {
      const parsed = toScheduleDefinition(definition);
      return parsed?.id === target.id;
    });
  }

  private toListItem(item: LoadedSchedule): ScheduleListItem {
    return {
      id: item.id,
      key: item.key,
      modeName: item.modeName,
      cron: item.cron,
      channelId: item.channelId,
      modeId: item.modeId,
      model: item.model,
      enabled: item.enabled,
      source: item.sourceLabel,
    };
  }

  private async resolveTextChannel(channelId: string): Promise<TextBasedChannel | null> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        return null;
      }
      return channel;
    } catch {
      return null;
    }
  }
}

function toScheduleDefinition(value: unknown): ScheduleDefinition | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const item = value as Partial<ScheduleDefinition>;
  const legacyModeId = (value as Record<string, unknown>).agentId;
  if (!isNonEmptyString(item.id)) {
    return null;
  }
  if (!isNonEmptyString(item.cron)) {
    return null;
  }
  if (!isNonEmptyString(item.channelId)) {
    return null;
  }
  if (!isNonEmptyString(item.prompt)) {
    return null;
  }

  const modeName = typeof item.modeName === "string" ? item.modeName.trim() : "";
  const modeId = normalizeModeId(item.modeId ?? legacyModeId);

  const model = typeof item.model === "string" && item.model.trim() ? item.model.trim() : undefined;

  return {
    id: item.id.trim(),
    cron: item.cron.trim(),
    channelId: item.channelId.trim(),
    prompt: item.prompt.trim(),
    modeId: modeId || undefined,
    enabled: item.enabled !== false,
    modeName: modeName || undefined,
    model,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeModeId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const clean = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return clean || null;
}

const SCHEDULE_TIME_ZONE = "Asia/Seoul";
const SCHEDULE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: SCHEDULE_TIME_ZONE,
  hour12: false,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});
const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function toMinuteBucket(date: CronDateTime): string {
  return `${date.year}-${date.month}-${date.dayOfMonth}-${date.hour}-${date.minute}`;
}

function getCronDateTime(date: Date): CronDateTime {
  const parts = new Map<string, string>();
  for (const part of SCHEDULE_PARTS_FORMATTER.formatToParts(date)) {
    if (part.type === "literal") {
      continue;
    }
    parts.set(part.type, part.value);
  }

  const weekdayLabel = parts.get("weekday");
  if (!weekdayLabel) {
    throw new Error(`failed to read weekday in timezone ${SCHEDULE_TIME_ZONE}`);
  }

  const dayOfWeek = WEEKDAY_TO_INDEX[weekdayLabel];
  if (dayOfWeek === undefined) {
    throw new Error(`unsupported weekday "${weekdayLabel}" in timezone ${SCHEDULE_TIME_ZONE}`);
  }

  return {
    year: parseRequiredCronPart(parts, "year"),
    month: parseRequiredCronPart(parts, "month"),
    dayOfMonth: parseRequiredCronPart(parts, "day"),
    hour: parseRequiredCronPart(parts, "hour"),
    minute: parseRequiredCronPart(parts, "minute"),
    dayOfWeek,
  };
}

function parseRequiredCronPart(parts: Map<string, string>, key: string): number {
  const raw = parts.get(key);
  if (!raw) {
    throw new Error(`failed to read ${key} in timezone ${SCHEDULE_TIME_ZONE}`);
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`invalid ${key} value "${raw}" in timezone ${SCHEDULE_TIME_ZONE}`);
  }
  return value;
}

function parseCron(input: string): CronExpression {
  const fields = input.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("cron requires 5 fields");
  }

  return {
    minute: parseCronField(fields[0]!, 0, 59, false),
    hour: parseCronField(fields[1]!, 0, 23, false),
    dayOfMonth: parseCronField(fields[2]!, 1, 31, false),
    month: parseCronField(fields[3]!, 1, 12, false),
    dayOfWeek: parseCronField(fields[4]!, 0, 7, true),
  };
}

function parseCronField(
  input: string,
  min: number,
  max: number,
  normalizeWeekday: boolean,
): CronField {
  const value = input.trim();
  if (!value) {
    throw new Error("empty cron field");
  }

  if (value === "*") {
    return {
      wildcard: true,
      values: rangeToSet(min, max, 1, normalizeWeekday),
    };
  }

  const values = new Set<number>();
  const parts = value.split(",");
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) {
      throw new Error(`invalid cron token "${value}"`);
    }

    if (part.includes("/")) {
      const [baseRaw, stepRaw] = part.split("/");
      const step = parseNumber(stepRaw, "step");
      if (step <= 0) {
        throw new Error(`invalid step "${stepRaw}"`);
      }

      const base = (baseRaw || "").trim();
      if (base === "*") {
        addSet(values, rangeToSet(min, max, step, normalizeWeekday));
        continue;
      }

      const [start, end] = parseRange(base, min, max);
      addSet(values, rangeToSet(start, end, step, normalizeWeekday));
      continue;
    }

    if (part.includes("-")) {
      const [start, end] = parseRange(part, min, max);
      addSet(values, rangeToSet(start, end, 1, normalizeWeekday));
      continue;
    }

    const single = parseNumber(part, "value");
    validateBounds(single, min, max);
    values.add(normalizeWeekday ? normalizeDayOfWeek(single) : single);
  }

  if (values.size === 0) {
    throw new Error(`empty cron field "${value}"`);
  }

  return { wildcard: false, values };
}

function parseRange(input: string, min: number, max: number): [number, number] {
  const [startRaw, endRaw] = input.split("-");
  const start = parseNumber(startRaw, "range start");
  const end = parseNumber(endRaw, "range end");
  validateBounds(start, min, max);
  validateBounds(end, min, max);
  if (start > end) {
    throw new Error(`invalid range "${input}"`);
  }
  return [start, end];
}

function parseNumber(value: string | undefined, label: string): number {
  const parsed = Number.parseInt((value || "").trim(), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`invalid ${label}`);
  }
  return parsed;
}

function validateBounds(value: number, min: number, max: number): void {
  if (value < min || value > max) {
    throw new Error(`value ${value} out of bounds (${min}-${max})`);
  }
}

function rangeToSet(
  start: number,
  end: number,
  step: number,
  normalizeWeekday: boolean,
): Set<number> {
  const values = new Set<number>();
  for (let value = start; value <= end; value += step) {
    values.add(normalizeWeekday ? normalizeDayOfWeek(value) : value);
  }
  return values;
}

function addSet(target: Set<number>, source: Set<number>): void {
  for (const value of source) {
    target.add(value);
  }
}

function normalizeDayOfWeek(value: number): number {
  return value === 7 ? 0 : value;
}

function matchesCron(cron: CronExpression, date: CronDateTime): boolean {
  const minute = date.minute;
  const hour = date.hour;
  const dayOfMonth = date.dayOfMonth;
  const month = date.month;
  const dayOfWeek = date.dayOfWeek;

  if (!cron.minute.values.has(minute)) {
    return false;
  }
  if (!cron.hour.values.has(hour)) {
    return false;
  }
  if (!cron.month.values.has(month)) {
    return false;
  }

  const domMatch = cron.dayOfMonth.values.has(dayOfMonth);
  const dowMatch = cron.dayOfWeek.values.has(dayOfWeek);

  let dayMatch = false;
  if (cron.dayOfMonth.wildcard && cron.dayOfWeek.wildcard) {
    dayMatch = true;
  } else if (cron.dayOfMonth.wildcard) {
    dayMatch = dowMatch;
  } else if (cron.dayOfWeek.wildcard) {
    dayMatch = domMatch;
  } else {
    dayMatch = domMatch || dowMatch;
  }

  return dayMatch;
}

function parseJsonWithComments(input: string): unknown {
  // schedules.json allows JSONC-style comments in the spec examples.
  const withoutBlockComments = input.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments
    .split("\n")
    .map((line) => stripLineComment(line))
    .join("\n");
  return JSON.parse(withoutLineComments);
}

function stripLineComment(line: string): string {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString && ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}
