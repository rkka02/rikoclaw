import fs from "node:fs";
import path from "node:path";
import { AttachmentBuilder } from "discord.js";
import type { ChatInputCommandInteraction, Message, TextBasedChannel } from "discord.js";
import type { Config } from "../utils/config.js";
import { MechoClient, buildMechoSessionKey } from "../integrations/mecho-client.js";
import { formatError, splitMessage } from "../utils/formatter.js";
import type { EngineType, LLMRunner, RunEvent, RunOptions, RunResult, UsageInfo } from "./llm-runner.js";
import {
  isCancelledError,
  isMaxTurnsError,
  isSessionResumeError,
  isTransientApiError,
} from "./retry-policy.js";
import { SessionManager } from "./session-manager.js";
import { VerboseManager } from "./verbose-manager.js";
import { PersonaManager } from "./persona-manager.js";
import { MechoModeManager } from "./mecho-mode-manager.js";
import {
  RESTART_DIRECTIVE_FILE_NAME,
  RestartManager,
  type RestartDirective,
  type RestartScheduleInput,
} from "./restart-manager.js";

export interface DiscordAttachmentInfo {
  url: string;
  name: string;
  size: number;
  contentType: string | null;
}

export interface QueueTask {
  prompt: string;
  sessionId: string | null;
  sessionUserId?: string | null;
  mechoModeId?: string | null;
  model: string | null;
  taskKey: string;
  respondTo: RespondTarget;
  createdAt: number;
  engine: EngineType;
  attachments?: DiscordAttachmentInfo[];
  modeName?: string;
  onComplete?: (result: RunResult) => void;
  rotateFromSessionId?: string | null;
}

export type RespondTarget =
  | { type: "interaction"; interaction: ChatInputCommandInteraction }
  | { type: "message"; message: Message }
  | { type: "channel"; channel: TextBasedChannel };

export interface EnqueueResult {
  accepted: boolean;
  reason: "ok" | "queue_full" | "duplicate";
  position: number;
}

export interface CancelResult {
  cancelledRunning: boolean;
  removedPending: number;
}

export interface CurrentTaskSnapshot {
  taskKey: string;
  engine: EngineType;
  model: string | null;
  createdAt: number;
  startedAt: number;
  waitMs: number;
  elapsedMs: number;
  respondToType: RespondTarget["type"];
}

interface LiveState {
  lastStatus: string | null;
  recentEvents: string[];
  assistantTail: string;
  updatedAt: number;
}

interface TurnWorkspace {
  rootDir: string;
  inputDir: string;
  outputDir: string;
}

interface RunningTaskState {
  task: QueueTask;
  startedAt: number;
  stopTyping: () => void;
  liveUpdate: LiveUpdate | null;
  liveState: LiveState | null;
  turnWorkspace: TurnWorkspace;
  turnInputFiles: string[];
  abortRun: (() => void) | null;
}

interface RestartDirectiveHandlingResult {
  notice: string | null;
  cleanedText: string | null;
  skipFileNames: Set<string>;
}

export class QueueManager {
  private readonly queue: QueueTask[] = [];
  private readonly runningTasks = new Map<string, RunningTaskState>();
  private readonly cancelRequestedTaskKeys = new Set<string>();
  private restartShutdownRequested = false;
  private turnSequence = 0;

  constructor(
    private readonly runners: Map<string, LLMRunner>,
    private readonly sessions: SessionManager,
    private readonly config: Config,
    private readonly verbose: VerboseManager,
    private readonly personas: PersonaManager,
    private readonly mechoModes: MechoModeManager,
    private readonly restarts: RestartManager,
  ) {}

  private getRunner(engine: string): LLMRunner {
    return this.runners.get(engine) ?? this.runners.get("claude")!;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get activeRunCount(): number {
    return this.runningTasks.size;
  }

  get totalInFlightCount(): number {
    return this.queue.length + this.runningTasks.size;
  }

  get isBusy(): boolean {
    return this.runningTasks.size > 0;
  }

  getLiveSnapshot(taskKey: string): { content: string; updatedAt: number } | null {
    const state = this.runningTasks.get(taskKey);
    if (!state || !state.liveState) {
      return null;
    }
    return {
      content: buildLiveContent(state.task, state.startedAt, state.liveState),
      updatedAt: state.liveState.updatedAt,
    };
  }

  getTaskSnapshot(taskKey: string): CurrentTaskSnapshot | null {
    const state = this.runningTasks.get(taskKey);
    if (!state) {
      return null;
    }
    return this.toTaskSnapshot(state);
  }

  getCurrentTaskSnapshot(): CurrentTaskSnapshot | null {
    if (this.runningTasks.size === 0) {
      return null;
    }

    let current: RunningTaskState | null = null;
    for (const state of this.runningTasks.values()) {
      if (!current || state.startedAt < current.startedAt) {
        current = state;
      }
    }
    if (!current) {
      return null;
    }
    return this.toTaskSnapshot(current);
  }

  private toTaskSnapshot(state: RunningTaskState): CurrentTaskSnapshot {
    const task = state.task;
    const startedAt = state.startedAt;
    return {
      taskKey: task.taskKey,
      engine: task.engine,
      model: task.model,
      createdAt: task.createdAt,
      startedAt,
      waitMs: startedAt - task.createdAt,
      elapsedMs: Date.now() - startedAt,
      respondToType: task.respondTo.type,
    };
  }

  listPendingTaskKeys(limit = 10): string[] {
    return this.queue.slice(0, Math.max(0, limit)).map((task) => task.taskKey);
  }

  /**
   * Pause live update message edits for the current running task.
   * Runner event capture continues so `/verbose on` can resume immediately.
   */
  disableLiveUpdates(taskKey: string): boolean {
    const state = this.runningTasks.get(taskKey);
    if (!state) {
      return false;
    }
    if (!state.liveUpdate) {
      return false;
    }
    state.liveUpdate.setEnabled(false);
    return true;
  }

  /**
   * Enable (or resume) live updates for the current running task.
   * If a live message hasn't been created yet, this will create one and start streaming immediately.
   */
  async enableLiveUpdates(taskKey: string): Promise<boolean> {
    const state = this.runningTasks.get(taskKey);
    if (!state || !state.liveState) {
      return false;
    }
    if (state.task.respondTo.type === "channel") {
      return false;
    }

    if (state.liveUpdate) {
      state.liveUpdate.setEnabled(true);
      state.liveUpdate.markDirty();
      return true;
    }

    const live = await LiveUpdate.tryCreate(
      state.task.respondTo,
      state.task,
      state.startedAt,
      state.liveState,
    );
    if (!live) {
      return false;
    }
    state.liveUpdate = live;
    return true;
  }

  enqueue(task: QueueTask): EnqueueResult {
    if (this.hasTask(task.taskKey)) {
      const position = this.positionOf(task.taskKey);
      console.log(
        `[queue] duplicate key=${task.taskKey} position=${position} pending=${this.queue.length} active=${this.runningTasks.size}`,
      );
      return { accepted: false, reason: "duplicate", position };
    }

    if (this.totalInFlightCount >= this.config.maxQueueSize) {
      console.log(
        `[queue] full key=${task.taskKey} inFlight=${this.totalInFlightCount} max=${this.config.maxQueueSize}`,
      );
      return {
        accepted: false,
        reason: "queue_full",
        position: this.config.maxQueueSize,
      };
    }

    this.queue.push(task);
    console.log(
      `[queue] enqueue key=${task.taskKey} position=${this.positionOf(task.taskKey)} pending=${this.queue.length} active=${this.runningTasks.size}`,
    );
    this.processNext();
    return { accepted: true, reason: "ok", position: this.positionOf(task.taskKey) };
  }

  cancel(taskKey: string): CancelResult {
    let cancelledRunning = false;
    const running = this.runningTasks.get(taskKey);
    if (running) {
      this.cancelRequestedTaskKeys.add(taskKey);
      if (running.abortRun) {
        try {
          running.abortRun();
        } catch (error: unknown) {
          console.error(`[queue] cancel abort failed key=${taskKey}:`, error);
        }
      } else {
        // Race-safe retry: the runner may not have published its abort handle yet.
        this.retryCancelActiveRun(taskKey);
      }
      cancelledRunning = true;
    }

    let removedPending = 0;
    const cancelledPendingTasks: QueueTask[] = [];
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const queued = this.queue[index];
      if (!queued || queued.taskKey !== taskKey) {
        continue;
      }
      cancelledPendingTasks.push(queued);
      this.queue.splice(index, 1);
      removedPending += 1;
    }

    for (const cancelledTask of cancelledPendingTasks) {
      void this.sendResponse(cancelledTask.respondTo, buildCancelledResult());
    }

    if (cancelledRunning || removedPending > 0) {
      console.log(
        `[queue] cancel key=${taskKey} running=${cancelledRunning} removedPending=${removedPending} pending=${this.queue.length} active=${this.runningTasks.size}`,
      );
    } else {
      console.log(`[queue] cancel miss key=${taskKey}`);
    }

    return { cancelledRunning, removedPending };
  }

  private retryCancelActiveRun(taskKey: string): void {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const running = this.runningTasks.get(taskKey);
      if (!running) {
        clearInterval(timer);
        return;
      }
      if (running.abortRun) {
        try {
          running.abortRun();
        } catch (error: unknown) {
          console.error(`[queue] retry cancel failed key=${taskKey}:`, error);
        }
        clearInterval(timer);
        return;
      }
      if (attempts >= 20) {
        clearInterval(timer);
      }
    }, 50);
    timer.unref?.();
  }

  hasTask(taskKey: string): boolean {
    if (this.runningTasks.has(taskKey)) {
      return true;
    }
    return this.queue.some((task) => task.taskKey === taskKey);
  }

  positionOf(taskKey: string): number {
    if (this.runningTasks.has(taskKey)) {
      return 1;
    }

    const index = this.queue.findIndex((task) => task.taskKey === taskKey);
    if (index >= 0) {
      return index + this.runningTasks.size + 1;
    }

    return this.totalInFlightCount + 1;
  }

  private pushLiveRecent(state: LiveState, line: string): void {
    if (!line) {
      return;
    }
    state.recentEvents.push(line);
    while (state.recentEvents.length > 12) {
      state.recentEvents.shift();
    }
  }

  private handleLiveEvent(event: RunEvent, running: RunningTaskState): void {
    const state = running.liveState;
    if (!state) {
      return;
    }

    state.updatedAt = Date.now();

    if (event.type === "status") {
      const message = event.message || "";
      state.lastStatus = message;
      this.pushLiveRecent(state, `status: ${message}`);
      running.liveUpdate?.markDirty();
      return;
    }

    if (event.type === "assistant_delta") {
      if (event.text) {
        state.assistantTail = trimTail(`${state.assistantTail}${event.text}`, 900);
        running.liveUpdate?.markDirty();
      }
      return;
    }

    if (event.type === "tool_use") {
      this.pushLiveRecent(state, `tool: ${formatToolUse(event.name, event.input)}`);
      running.liveUpdate?.markDirty();
      return;
    }

    if (event.type === "tool_result") {
      this.pushLiveRecent(state, `result: ${formatToolResult(event)}`);
      running.liveUpdate?.markDirty();
    }
  }

  private processNext(): void {
    while (
      this.runningTasks.size < this.config.maxConcurrentRuns &&
      this.queue.length > 0
    ) {
      const task = this.queue.shift();
      if (!task) {
        break;
      }
      void this.runQueuedTask(task);
    }
  }

  private async runQueuedTask(task: QueueTask): Promise<void> {
    let turnWorkspace: TurnWorkspace;
    try {
      turnWorkspace = createTurnWorkspace(this.config.dataDir, task.taskKey, ++this.turnSequence);
    } catch (error: unknown) {
      console.error(`[queue] failed to create turn workspace key=${task.taskKey}:`, error);
      const errText = error instanceof Error ? error.message : String(error);
      await this.sendError(task.respondTo, errText);
      return;
    }

    const startedAt = Date.now();
    const state: RunningTaskState = {
      task,
      startedAt,
      stopTyping: this.startTypingIndicator(task.respondTo),
      liveUpdate: null,
      liveState: null,
      turnWorkspace,
      turnInputFiles: [],
      abortRun: null,
    };
    this.runningTasks.set(task.taskKey, state);

    const canStream = task.respondTo.type !== "channel";
    const isHeartbeat = task.taskKey.startsWith("heartbeat:");
    let onEvent: ((event: RunEvent) => void) | undefined;
    // For heartbeat tasks, collect all assistant text blocks via streaming
    // so we can recover the full report even after an internal context rotation.
    const heartbeatAssistantBlocks: string[] = [];
    let heartbeatCurrentBlock = "";
    console.log(
      `[queue] start key=${task.taskKey} waitMs=${startedAt - task.createdAt} remaining=${this.queue.length} active=${this.runningTasks.size}`,
    );

    try {
      if (canStream) {
        state.liveState = {
          lastStatus: null,
          recentEvents: [],
          assistantTail: "",
          updatedAt: startedAt,
        };

        const { userId, contextId } = this.extractIds(task);
        if (this.verbose.isEnabled(userId, contextId)) {
          state.liveUpdate = await LiveUpdate.tryCreate(
            task.respondTo,
            task,
            startedAt,
            state.liveState,
          );
        }

        onEvent = (event: RunEvent): void => {
          const running = this.runningTasks.get(task.taskKey);
          if (!running || running !== state) {
            return;
          }
          this.handleLiveEvent(event, running);
        };
      } else if (isHeartbeat) {
        // Heartbeat-only streaming: collect assistant text blocks without live UI updates.
        // Each assistant turn (delimited by tool_use events) is stored as a separate block.
        onEvent = (event: RunEvent): void => {
          if (event.type === "assistant_delta" && event.text) {
            heartbeatCurrentBlock += event.text;
          } else if (event.type === "tool_use" || event.type === "tool_result") {
            if (heartbeatCurrentBlock.trim()) {
              heartbeatAssistantBlocks.push(heartbeatCurrentBlock.trim());
              heartbeatCurrentBlock = "";
            }
          }
        };
      }

      fs.mkdirSync(this.config.claudeInputDir, { recursive: true });
      state.turnInputFiles = moveStagedInputFiles(
        this.config.claudeInputDir,
        state.turnWorkspace.inputDir,
      );
      if (state.turnInputFiles.length > 0) {
        this.handleLiveEvent(
          {
            type: "status",
            message: `Using ${state.turnInputFiles.length} file(s) from input folder.`,
          },
          state,
        );
        console.log(
          `[queue] using ${state.turnInputFiles.length} staged input file(s) for key=${task.taskKey}`,
        );
      }

      if (task.attachments && task.attachments.length > 0) {
        this.handleLiveEvent(
          {
            type: "status",
            message: `Downloading ${task.attachments.length} Discord attachment(s)...`,
          },
          state,
        );
        const downloadedFiles = await downloadAttachments(
          task.attachments,
          state.turnWorkspace.inputDir,
        );
        console.log(
          `[queue] downloaded ${downloadedFiles.length}/${task.attachments.length} attachment(s) for key=${task.taskKey}`,
        );
        state.turnInputFiles = collectInputFiles(state.turnWorkspace.inputDir);
      }

      let result = await this.runTask(
        task,
        state.turnInputFiles,
        state.turnWorkspace,
        onEvent,
        (abort) => {
          state.abortRun = abort;
          if (this.cancelRequestedTaskKeys.has(task.taskKey)) {
            try {
              abort();
            } catch (error: unknown) {
              console.error(`[queue] immediate cancel failed key=${task.taskKey}:`, error);
            }
          }
        },
      );

      // Heartbeat report-loss fix: when Claude internally rotates context during a
      // heartbeat run, `result.text` only contains the *last* assistant message
      // (often a short meta-message like "All tasks done ✅"). By streaming events
      // we capture every assistant text block. If a longer block exists, use it
      // instead so the full exploration report reaches Discord.
      if (isHeartbeat && result.success) {
        // Flush any trailing block that wasn't terminated by a tool event.
        if (heartbeatCurrentBlock.trim()) {
          heartbeatAssistantBlocks.push(heartbeatCurrentBlock.trim());
          heartbeatCurrentBlock = "";
        }
        if (heartbeatAssistantBlocks.length > 0) {
          const longest = heartbeatAssistantBlocks.reduce((a, b) =>
            a.length >= b.length ? a : b,
          );
          if (longest.length > result.text.trim().length) {
            console.log(
              `[queue] heartbeat report-loss fix: using longer streamed block ` +
              `(${longest.length} chars) instead of result.text (${result.text.trim().length} chars), ` +
              `blocks=${heartbeatAssistantBlocks.length}`,
            );
            result = { ...result, text: longest };
          }
        }
      }

      const { userId, contextId } = this.extractIds(task);
      const persistedSessionId = result.sessionId || task.sessionId;

      if (result.sessionId) {
        this.sessions.saveSession(userId, contextId, task.engine, result.sessionId);
      } else if (result.success && task.sessionId) {
        this.sessions.touchSession(userId, contextId, task.engine);
      }

      if (
        this.config.sessionRotationEnabled &&
        result.success &&
        result.usage &&
        result.sessionId
      ) {
        const rotationNotice = await this.checkAndRotateSession(
          userId,
          contextId,
          task.engine,
          result.sessionId,
          result.usage,
        );
        if (rotationNotice) {
          result = { ...result, text: `${result.text}\n\n${rotationNotice}` };
        }
      }

      let restartHandling: RestartDirectiveHandlingResult | null = null;
      if (result.success) {
        restartHandling = this.handleRestartDirective({
          task,
          userId,
          contextId,
          sessionId: persistedSessionId,
          resultText: result.text,
          outputDir: state.turnWorkspace.outputDir,
        });
        if (restartHandling.cleanedText !== null) {
          result = {
            ...result,
            text: restartHandling.cleanedText,
          };
        }
        if (restartHandling.notice) {
          result = {
            ...result,
            text: appendResultText(result.text, restartHandling.notice),
          };
        }
      }

      const attachments = collectOutputFiles(state.turnWorkspace.outputDir, {
        skipNames: restartHandling?.skipFileNames || new Set([RESTART_DIRECTIVE_FILE_NAME]),
      });
      if (state.liveUpdate) {
        await state.liveUpdate.sendFinal(result, attachments);
      } else {
        await this.sendResponse(task.respondTo, result, attachments);
      }
      task.onComplete?.(result);
      console.log(
        `[queue] done key=${task.taskKey} success=${result.success} attachments=${attachments.length} durationMs=${result.durationMs} totalMs=${Date.now() - startedAt} remaining=${this.queue.length} active=${this.runningTasks.size}`,
      );
    } catch (error: unknown) {
      console.error(`[queue] fail key=${task.taskKey}:`, error);
      const errText = error instanceof Error ? error.message : String(error);
      if (state.liveUpdate) {
        await state.liveUpdate.sendFinal(
          {
            success: false,
            text: "",
            sessionId: null,
            error: errText,
            durationMs: Date.now() - startedAt,
            isTimeout: false,
            usage: null,
          },
          [],
        );
      } else {
        await this.sendError(task.respondTo, errText);
      }
    } finally {
      state.liveUpdate?.stop();
      state.stopTyping();
      this.cancelRequestedTaskKeys.delete(task.taskKey);
      this.runningTasks.delete(task.taskKey);
      cleanupTurnWorkspace(state.turnWorkspace);
      this.processNext();
      this.maybeShutdownForRestart();
    }
  }

  private async runTask(
    task: QueueTask,
    inputFiles: string[] = [],
    turnWorkspace: TurnWorkspace,
    onEvent?: (event: RunEvent) => void,
    onAbortReady?: (abort: () => void) => void,
  ): Promise<RunResult> {
    if (this.cancelRequestedTaskKeys.has(task.taskKey)) {
      return buildCancelledResult();
    }

    const runner = this.getRunner(task.engine);
    const { userId, contextId } = this.extractIds(task);
    const mechoClient = new MechoClient(this.config);
    const baseSystemPrompt = this.personas.buildSystemPrompt(contextId, task.modeName);
    const systemPrompt = appendAttachmentSystemPrompt(
      baseSystemPrompt,
      turnWorkspace.inputDir,
      turnWorkspace.outputDir,
    );

    if (task.rotateFromSessionId && this.config.sessionRotationEnabled) {
      console.log(
        `[rotation] /new requested summary for ${userId}:${contextId}:${task.engine} sessionId=${task.rotateFromSessionId}`,
      );
      try {
        const summary = await this.generateRotationSummary(task.engine, task.rotateFromSessionId);
        if (summary) {
          this.sessions.saveSummary(userId, contextId, task.engine, summary, task.rotateFromSessionId, 0);
          console.log(
            `[rotation] /new summary saved for ${userId}:${contextId}:${task.engine} len=${summary.length}`,
          );
        } else {
          console.warn(
            `[rotation] /new summary generation failed for ${userId}:${contextId}:${task.engine}`,
          );
        }
      } catch (error: unknown) {
        console.error(`[rotation] /new summary generation error:`, error);
      }
    }

    let taskPrompt = task.prompt;
    if (!task.sessionId) {
      const pendingSummary = this.sessions.consumeSummary(userId, contextId, task.engine);
      if (pendingSummary) {
        console.log(
          `[rotation] injecting summary for ${userId}:${contextId}:${task.engine} len=${pendingSummary.length}`,
        );
        taskPrompt = `${buildRotationSummaryXml(pendingSummary)}\n\n${taskPrompt}`;
      }
    }

    const prompt = appendInputFilesPrompt(taskPrompt, inputFiles, turnWorkspace.inputDir);
    const boundMechoModeId = task.mechoModeId || this.mechoModes.getModeId(userId, contextId);
    const mechoModeId = mechoClient.enabled
      ? mechoClient.resolveModeId(boundMechoModeId || null)
      : null;
    const mechoSessionKey = mechoModeId
      ? buildMechoSessionKey({
          modeId: mechoModeId,
          engine: task.engine,
          userId,
          contextId,
        })
      : null;

    const runWithMecho = async (options: RunOptions): Promise<RunResult> => {
      if (!mechoClient.enabled || !mechoModeId || !mechoSessionKey) {
        return runner.run(options);
      }

      let prepareId: string | null = null;
      let prompt = options.prompt;
      try {
        console.log(
          `[mecho] prepare call key=${task.taskKey} mode=${mechoModeId} session=${mechoSessionKey}`,
        );
        const prepared = await mechoClient.prepareTurn({
          modeId: mechoModeId,
          sessionKey: mechoSessionKey,
          engine: task.engine,
          // New LLM sessions (e.g. /new) must receive a full snapshot at least once.
          forceFull: !options.sessionId,
        });
        if (prepared) {
          prepareId = prepared.prepareId;
          console.log(
            `[mecho] prepare ok key=${task.taskKey} mode=${prepared.mode} from=${prepared.fromRevision} to=${prepared.toRevision} xmlLen=${prepared.xml.length}`,
          );
          if ((prepared.mode === "full" || prepared.mode === "delta") && prepared.xml.trim()) {
            prompt = `${prepared.xml}\n\n${prompt}`;
          }
        }
      } catch (error: unknown) {
        console.warn("[mecho] prepare failed; continuing without memory injection:", error);
      }

      const result = await runner.run({
        ...options,
        prompt,
      });

      if (prepareId) {
        try {
          console.log(
            `[mecho] ack call key=${task.taskKey} mode=${mechoModeId} prepareId=${prepareId} status=${result.success ? "success" : "failed"}`,
          );
          await mechoClient.ackTurn({
            modeId: mechoModeId,
            prepareId,
            sessionKey: mechoSessionKey,
            status: result.success ? "success" : "failed",
          });
          console.log(`[mecho] ack ok key=${task.taskKey} prepareId=${prepareId}`);
        } catch (error: unknown) {
          console.warn("[mecho] ack failed:", error);
        }
      }
      return result;
    };

    const runOptions: RunOptions = {
      prompt,
      systemPrompt: systemPrompt || undefined,
      sessionId: task.sessionId ?? undefined,
      model: task.model ?? undefined,
      onEvent,
      onAbortReady,
      envOverrides: this.buildRunnerEnvOverrides(mechoModeId),
    };

    let result = await runWithMecho(runOptions);
    if (this.cancelRequestedTaskKeys.has(task.taskKey)) {
      return isCancelledError(result.error || "") ? result : buildCancelledResult();
    }

    if (!result.success && runner.supportsMaxTurnsRetry && isMaxTurnsError(result.error || "")) {
      console.log(
        `[queue] max_turns retry key=${task.taskKey} rerun without max-turn cap`,
      );
      result = await runWithMecho({
        ...runOptions,
        maxTurns: null,
      });
      if (this.cancelRequestedTaskKeys.has(task.taskKey)) {
        return isCancelledError(result.error || "") ? result : buildCancelledResult();
      }
    }

    if (!result.success && result.isTimeout) {
      console.log(
        `[queue] timeout retry key=${task.taskKey} using default model selection`,
      );
      result = await runWithMecho({
        ...runOptions,
        model: "",
      });
      if (this.cancelRequestedTaskKeys.has(task.taskKey)) {
        return isCancelledError(result.error || "") ? result : buildCancelledResult();
      }
    }

    if (!result.success && isTransientApiError(`${result.error || ""}\n${result.text || ""}`)) {
      console.log(`[queue] transient api retry key=${task.taskKey} after backoff`);
      await sleep(1200);
      result = await runWithMecho(runOptions);
      if (this.cancelRequestedTaskKeys.has(task.taskKey)) {
        return isCancelledError(result.error || "") ? result : buildCancelledResult();
      }
    }

    if (
      !result.success &&
      runner.supportsSessionResume &&
      task.sessionId &&
      isSessionResumeError(`${result.error || ""}\n${result.text || ""}`)
    ) {
      const { userId, contextId } = this.extractIds(task);
      this.sessions.deleteSession(userId, contextId, task.engine);
      result = await runWithMecho({
        ...runOptions,
        sessionId: undefined,
      });
      if (this.cancelRequestedTaskKeys.has(task.taskKey)) {
        return isCancelledError(result.error || "") ? result : buildCancelledResult();
      }
    }

    return result;
  }

  private buildRunnerEnvOverrides(mechoModeId: string | null): Record<string, string> | undefined {
    if (!this.config.mechoEnabled) {
      return undefined;
    }

    const env: Record<string, string> = {
      MECHO_API_URL: this.config.mechoApiUrl,
    };
    if (mechoModeId) {
      env.MECHO_MODE_ID = mechoModeId;
      // Keep shell snippets that reference MECHO_DEFAULT_MODE_ID aligned with /mode set binding.
      env.MECHO_DEFAULT_MODE_ID = mechoModeId;
    }
    return env;
  }

  private async checkAndRotateSession(
    userId: string,
    contextId: string,
    engine: EngineType,
    sessionId: string,
    usage: UsageInfo,
  ): Promise<string | null> {
    const contextWindow = usage.contextWindow ?? this.config.codexDefaultContextWindow;
    if (!contextWindow || contextWindow <= 0) {
      return null;
    }

    this.sessions.updateSessionTokens(userId, contextId, engine, usage.totalContextTokens, contextWindow);

    const threshold = this.config.sessionRotationThreshold;
    if (usage.totalContextTokens < contextWindow * threshold) {
      return null;
    }

    console.log(
      `[rotation] threshold exceeded for ${userId}:${contextId}:${engine} tokens=${usage.totalContextTokens}/${contextWindow} (${(usage.totalContextTokens / contextWindow * 100).toFixed(1)}%)`,
    );

    try {
      const summary = await this.generateRotationSummary(engine, sessionId);
      if (!summary) {
        console.warn(
          `[rotation] summary generation failed for ${userId}:${contextId}:${engine}, skipping rotation`,
        );
        return null;
      }

      this.sessions.saveSummary(
        userId,
        contextId,
        engine,
        summary,
        sessionId,
        usage.totalContextTokens,
      );

      this.sessions.deleteSession(userId, contextId, engine);

      console.log(
        `[rotation] session rotated for ${userId}:${contextId}:${engine} summaryLen=${summary.length}`,
      );

      return ROTATION_NOTICE;
    } catch (error: unknown) {
      console.error(`[rotation] failed for ${userId}:${contextId}:${engine}:`, error);
      return null;
    }
  }

  private async generateRotationSummary(
    engine: EngineType,
    sessionId: string,
  ): Promise<string | null> {
    const runner = this.getRunner(engine);
    const timeoutMs = this.config.sessionRotationSummaryTimeout;

    try {
      const result = await Promise.race<RunResult | null>([
        runner.run({
          prompt: ROTATION_SUMMARY_PROMPT,
          sessionId,
          maxTurns: 1,
        }),
        new Promise<null>((resolve) => {
          const timer = setTimeout(() => resolve(null), timeoutMs);
          timer.unref?.();
        }),
      ]);

      if (!result?.success || !result.text.trim()) {
        return null;
      }

      const summary = result.text.trim();
      return summary.length > 30000 ? summary.slice(0, 30000) : summary;
    } catch (error: unknown) {
      console.warn("[rotation] summary generation failed:", error);
      return null;
    }
  }

  private async sendResponse(
    target: RespondTarget,
    result: RunResult,
    attachments: AttachmentBuilder[] = [],
  ): Promise<void> {
    const chunks = buildResponseChunks(result);
    if (target.type === "interaction") {
      await sendToInteraction(target.interaction, chunks, attachments);
      return;
    }
    if (target.type === "message") {
      await sendToMessage(target.message, chunks, attachments);
      return;
    }
    await sendToChannel(target.channel, chunks, attachments);
  }

  private async sendError(target: RespondTarget, error: string): Promise<void> {
    const chunks = splitMessage(formatError(error, false));
    if (target.type === "interaction") {
      await sendToInteraction(target.interaction, chunks);
      return;
    }
    if (target.type === "message") {
      await sendToMessage(target.message, chunks);
      return;
    }
    await sendToChannel(target.channel, chunks);
  }

  private extractIds(task: QueueTask): { userId: string; contextId: string } {
    const target = task.respondTo;
    if (target.type === "interaction") {
      const userId = target.interaction.user.id;
      return {
        userId,
        contextId: resolveContextId(target.interaction.channel, userId),
      };
    }
    if (target.type === "channel") {
      const userId = task.sessionUserId?.trim() || `schedule:${target.channel.id}`;
      const contextId = resolveContextId(target.channel as Message["channel"], userId);
      return {
        userId,
        contextId,
      };
    }

    const userId = task.sessionUserId?.trim() || target.message.author.id;
    return {
      userId,
      contextId: resolveContextId(target.message.channel, userId),
    };
  }

  private handleRestartDirective(input: {
    task: QueueTask;
    userId: string;
    contextId: string;
    sessionId: string | null;
    resultText: string;
    outputDir: string;
  }): RestartDirectiveHandlingResult {
    const skipFileNames = new Set<string>([RESTART_DIRECTIVE_FILE_NAME]);
    let cleanedText: string | null = null;

    const read = this.restarts.readDirective(input.outputDir);
    for (const name of read.consumedFileNames) {
      skipFileNames.add(name);
    }

    let directive = read.directive;

    if (!read.directive && !read.error) {
      const inline = extractInlineRestartDirective(input.resultText, this.restarts);
      if (!inline) {
        return {
          notice: null,
          cleanedText,
          skipFileNames,
        };
      }
      directive = inline.directive;
      cleanedText = inline.cleanedText;
    }

    if (read.error) {
      return {
        notice: `[자동 재시작 실패]\n${read.error}`,
        cleanedText,
        skipFileNames,
      };
    }

    const channelId = this.extractChannelId(input.task.respondTo);
    if (!channelId) {
      return {
        notice: "[자동 재시작 실패]\n채널 ID를 확인할 수 없어 재개 작업을 예약하지 못했습니다.",
        cleanedText,
        skipFileNames,
      };
    }

    if (!directive) {
      return {
        notice: "[자동 재시작 실패]\n재시작 지시 파일을 해석하지 못했습니다.",
        cleanedText,
        skipFileNames,
      };
    }
    const scheduleInput: RestartScheduleInput = {
      channelId,
      userId: input.userId,
      contextId: input.contextId,
      sessionUserId: input.task.sessionUserId?.trim() || input.userId,
      engine: input.task.engine,
      sessionId: input.sessionId,
      model: input.task.model,
      modeName: input.task.modeName ?? null,
      mechoModeId: input.task.mechoModeId ?? null,
      reason: directive.reason,
      resumePrompt: directive.resumePrompt,
      delaySec: directive.delaySec,
    };

    const scheduled = this.restarts.scheduleRestart(scheduleInput);
    if (scheduled.status !== "scheduled") {
      return {
        notice: `[자동 재시작 실패]\n${scheduled.message}`,
        cleanedText,
        skipFileNames,
      };
    }

    this.restartShutdownRequested = true;
    const reasonLine = directive.reason.trim() ? directive.reason.trim() : "코드 변경 반영";
    return {
      notice: [
        "[자동 재시작 예약]",
        `사유: ${reasonLine}`,
        `${scheduled.message}`,
        "현재 응답을 전송한 뒤 큐가 비면 프로세스를 종료합니다.",
        "재시작 후 같은 세션이 자동으로 재개되며 결과는 이 디스코드 채널로 전송됩니다.",
      ].join("\n"),
      cleanedText,
      skipFileNames,
    };
  }

  private extractChannelId(target: RespondTarget): string | null {
    if (target.type === "interaction") {
      return target.interaction.channelId || null;
    }
    if (target.type === "message") {
      return target.message.channelId || null;
    }
    return target.channel.id || null;
  }

  private maybeShutdownForRestart(): void {
    if (!this.restartShutdownRequested) {
      return;
    }
    if (this.runningTasks.size > 0 || this.queue.length > 0) {
      return;
    }

    this.restartShutdownRequested = false;
    console.log("[restart] queue drained, shutting down for scheduled restart");
    try {
      process.kill(process.pid, "SIGTERM");
    } catch (error: unknown) {
      console.error("[restart] failed to send SIGTERM:", error);
    }
  }

  private startTypingIndicator(target: RespondTarget): () => void {
    if (target.type === "interaction") {
      return () => {};
    }

    const channel = (target.type === "message" ? target.message.channel : target.channel) as {
      sendTyping?: () => Promise<void>;
    };
    const sendTyping = channel.sendTyping?.bind(channel);
    if (!sendTyping) {
      return () => {};
    }

    let stopped = false;
    const tick = async (): Promise<void> => {
      if (stopped) {
        return;
      }
      try {
        await sendTyping();
      } catch (error: unknown) {
        console.error("[queue] sendTyping failed:", error);
      }
    };

    void tick();
    const interval = setInterval(() => {
      void tick();
    }, 7_000);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }
}

class LiveUpdate {
  private message: Message | null = null;
  private stopped = false;
  private enabled = true;
  private flushTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastFlushAt = 0;
  private pendingFlush = false;

  private constructor(
    private readonly target: RespondTarget,
    private readonly task: QueueTask,
    private readonly startedAt: number,
    private readonly state: LiveState,
  ) {}

  static async tryCreate(
    target: RespondTarget,
    task: QueueTask,
    startedAt: number,
    state: LiveState,
  ): Promise<LiveUpdate | null> {
    const live = new LiveUpdate(target, task, startedAt, state);
    const ok = await live.init();
    return ok ? live : null;
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
  }

  setEnabled(enabled: boolean): void {
    if (this.stopped) {
      return;
    }
    if (this.enabled === enabled) {
      return;
    }

    this.enabled = enabled;
    if (!this.enabled) {
      this.clearTimers();
      return;
    }

    this.startHeartbeat();
    this.markDirty();
  }

  markDirty(): void {
    if (this.stopped) {
      return;
    }
    this.pendingFlush = true;
    this.scheduleFlush();
  }

  async sendFinal(result: RunResult, attachments: AttachmentBuilder[]): Promise<void> {
    this.stop();

    const message = this.message;
    if (!message) {
      return;
    }

    const chunks = buildResponseChunks(result);
    const [first, ...rest] = chunks;
    const firstText = first || "완료";

    try {
      await message.edit({ content: firstText });
    } catch (error: unknown) {
      console.error("[live] message.edit failed:", error);
      return;
    }

    if (attachments.length > 0) {
      try {
        await message.reply({ files: attachments });
      } catch (error: unknown) {
        console.error("[live] failed to send attachments:", error);
      }
    }

    for (const chunk of rest) {
      await sendMessageChunk(message, chunk);
    }
  }

  private async init(): Promise<boolean> {
    const initial = this.buildContent();

    if (this.target.type === "message") {
      // If we already have a bot-authored message (e.g. from a slash command reply),
      // reuse it as the live-updated message to avoid extra clutter.
      if (this.target.message.author.bot) {
        this.message = this.target.message;
        try {
          await this.message.edit({ content: initial });
        } catch (error: unknown) {
          console.error("[live] edit existing message failed:", error);
          return false;
        }
      } else {
        try {
          this.message = await this.target.message.reply({ content: initial });
        } catch (error: unknown) {
          console.error("[live] message.reply failed, fallback to channel.send:", error);
          const channel = this.target.message.channel as { send?: (options: unknown) => Promise<unknown> };
          if (typeof channel.send !== "function") {
            return false;
          }
          try {
            this.message = (await channel.send({ content: initial })) as Message;
          } catch (sendError: unknown) {
            console.error("[live] channel.send failed:", sendError);
            return false;
          }
        }
      }
    } else if (this.target.type === "interaction") {
      const interaction = this.target.interaction;
      try {
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ content: initial });
        } else if (interaction.replied) {
          await interaction.followUp({ content: initial });
        } else {
          await interaction.reply({ content: initial });
        }

        try {
          // fetchReply uses the interaction webhook; if it fails, we'll fallback to channel.send below.
          this.message = (await interaction.fetchReply()) as Message;
        } catch (fetchError: unknown) {
          console.warn("[live] interaction.fetchReply failed:", fetchError);
        }
      } catch (error: unknown) {
        console.error("[live] interaction reply/edit failed:", error);
      }

      if (!this.message) {
        const channel = interaction.channel as { send?: (options: unknown) => Promise<unknown> };
        if (typeof channel.send !== "function") {
          return false;
        }
        try {
          this.message = (await channel.send({ content: initial })) as Message;
        } catch (sendError: unknown) {
          console.error("[live] channel.send fallback failed:", sendError);
          return false;
        }
      }
    } else {
      const channel = this.target.channel as { send?: (options: unknown) => Promise<unknown> };
      if (typeof channel.send !== "function") {
        return false;
      }
      try {
        this.message = (await channel.send({ content: initial })) as Message;
      } catch (error: unknown) {
        console.error("[live] channel.send failed:", error);
        return false;
      }
    }

    this.startHeartbeat();

    return Boolean(this.message);
  }

  private clearTimers(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startHeartbeat(): void {
    if (this.stopped || !this.enabled || this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      this.pendingFlush = true;
      this.scheduleFlush();
    }, 20_000);
    this.heartbeatTimer.unref?.();
  }

  private scheduleFlush(): void {
    if (this.stopped || !this.enabled || !this.message) {
      return;
    }
    if (!this.pendingFlush) {
      return;
    }

    const now = Date.now();
    const minIntervalMs = 1_500;
    const delayMs = Math.max(0, minIntervalMs - (now - this.lastFlushAt));
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delayMs);
    this.flushTimer.unref?.();
  }

  private async flush(): Promise<void> {
    if (this.stopped || !this.enabled || !this.message) {
      return;
    }

    this.lastFlushAt = Date.now();
    this.pendingFlush = false;
    const content = this.buildContent();
    try {
      await this.message.edit({ content });
    } catch (error: unknown) {
      console.error("[live] message.edit failed:", error);
    }
  }

  private buildContent(): string {
    return buildLiveContent(this.task, this.startedAt, this.state);
  }
}

function buildLiveContent(task: QueueTask, startedAt: number, state: LiveState): string {
  const elapsed = formatDurationShort(Date.now() - startedAt);
  const model = task.model?.trim() ? ` model=${task.model.trim()}` : "";
  const header = `작업 중 (${task.engine}${model}) · 경과 ${elapsed}\n/stop 으로 중단`;

  const blocks: string[] = [];
  if (state.lastStatus) {
    blocks.push(`상태: ${state.lastStatus}`);
  }
  if (state.recentEvents.length > 0) {
    blocks.push(
      `최근 이벤트\n\`\`\`\n${sanitizeCodeblockText(state.recentEvents.join("\n"))}\n\`\`\``,
    );
  }
  if (state.assistantTail.trim()) {
    blocks.push(
      `부분 응답\n\`\`\`\n${sanitizeCodeblockText(state.assistantTail.trim())}\n\`\`\``,
    );
  }

  const combined = [header, ...blocks].join("\n\n");
  return combined.length <= 1990 ? combined : `${combined.slice(0, 1980)}…`;
}

function buildResponseChunks(result: RunResult): string[] {
  if (!result.success) {
    return [formatError(result.error || "알 수 없는 오류", result.isTimeout)];
  }

  const text = result.text.trim();
  if (!text) {
    return [formatError("Claude가 빈 응답을 반환했습니다.", false)];
  }

  return splitMessage(text);
}

function appendResultText(currentText: string, extra: string): string {
  const base = currentText.trim();
  const addon = extra.trim();
  if (!base) {
    return addon;
  }
  if (!addon) {
    return base;
  }
  return `${base}\n\n${addon}`;
}

function extractInlineRestartDirective(
  text: string,
  restarts: RestartManager,
): { directive: RestartDirective; cleanedText: string } | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const wholeDirective = restarts.readDirectiveFromText(trimmed);
  if (wholeDirective) {
    return {
      directive: wholeDirective,
      cleanedText: "",
    };
  }

  const fencedRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match: RegExpExecArray | null = fencedRegex.exec(text);
  while (match) {
    const fullMatch = match[0];
    const jsonBody = match[1] || "";
    const directive = restarts.readDirectiveFromText(jsonBody.trim());
    if (directive) {
      const cleaned = text.replace(fullMatch, "").trim();
      return {
        directive,
        cleanedText: cleaned,
      };
    }
    match = fencedRegex.exec(text);
  }

  return null;
}

function buildCancelledResult(): RunResult {
  return {
    success: false,
    text: "",
    sessionId: null,
    error: "요청이 중단되었습니다.",
    durationMs: 0,
    isTimeout: false,
    usage: null,
  };
}

async function sendToInteraction(
  interaction: ChatInputCommandInteraction,
  chunks: string[],
  attachments: AttachmentBuilder[] = [],
): Promise<void> {
  if (chunks.length === 0 && attachments.length === 0) {
    return;
  }

  try {
    const [first, ...rest] = chunks;
    const firstPayload: { content?: string; files?: AttachmentBuilder[] } = {};
    if (first) {
      firstPayload.content = first;
    }
    if (attachments.length > 0) {
      firstPayload.files = attachments;
    }

    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply(firstPayload);
    } else if (interaction.replied) {
      await interaction.followUp(firstPayload);
    } else {
      await interaction.reply(firstPayload);
    }

    for (const chunk of rest) {
      await interaction.followUp({ content: chunk });
    }
  } catch (error: unknown) {
    console.error("Failed to send interaction response:", error);
  }
}

async function sendToMessage(
  message: Message,
  chunks: string[],
  attachments: AttachmentBuilder[] = [],
): Promise<void> {
  if (chunks.length === 0 && attachments.length === 0) {
    return;
  }

  for (let i = 0; i < chunks.length; i++) {
    const files = i === 0 && attachments.length > 0 ? attachments : undefined;
    const sent = await sendMessageChunk(message, chunks[i]!, files);
    if (!sent) {
      console.error("[queue] failed to send message chunk");
      break;
    }
  }

  if (chunks.length === 0 && attachments.length > 0) {
    await sendMessageChunk(message, "", attachments);
  }
}

async function sendToChannel(
  channel: TextBasedChannel,
  chunks: string[],
  attachments: AttachmentBuilder[] = [],
): Promise<void> {
  if (chunks.length === 0 && attachments.length === 0) {
    return;
  }

  const send = (channel as {
    send?: (options: unknown) => Promise<unknown>;
  }).send;

  if (typeof send !== "function") {
    console.error("[queue] target channel is not sendable");
    return;
  }

  for (let i = 0; i < chunks.length; i++) {
    try {
      const payload: { content: string; files?: AttachmentBuilder[] } = {
        content: chunks[i]!,
      };
      if (i === 0 && attachments.length > 0) {
        payload.files = attachments;
      }
      await send.call(channel, payload);
    } catch (error: unknown) {
      console.error("[queue] channel.send failed:", error);
      break;
    }
  }

  if (chunks.length === 0 && attachments.length > 0) {
    try {
      await send.call(channel, { files: attachments });
    } catch (error: unknown) {
      console.error("[queue] channel.send (files only) failed:", error);
    }
  }
}

async function sendMessageChunk(
  message: Message,
  chunk: string,
  files?: AttachmentBuilder[],
): Promise<boolean> {
  const payload: { content?: string; files?: AttachmentBuilder[] } = {};
  if (chunk) {
    payload.content = chunk;
  }
  if (files && files.length > 0) {
    payload.files = files;
  }

  try {
    await message.reply(payload);
    return true;
  } catch (replyError: unknown) {
    console.error("[queue] message.reply failed, fallback to channel.send:", replyError);
  }

  const channel = message.channel as { send?: (options: unknown) => Promise<unknown> };
  if (typeof channel.send === "function") {
    try {
      await channel.send(payload);
      return true;
    } catch (sendError: unknown) {
      console.error("[queue] channel.send fallback failed:", sendError);
    }
  }

  return false;
}

function formatDurationShort(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function trimTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(text.length - maxChars);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sanitizeCodeblockText(text: string): string {
  return text.replace(/```/g, "'''" );
}

function formatToolUse(name: string, input: unknown): string {
  const cleanName = name || "tool";
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    if (cleanName === "Bash" && typeof record.command === "string") {
      return `Bash ${record.command}`;
    }
    const path = typeof record.path === "string" ? record.path : "";
    if (path) {
      return `${cleanName} ${path}`;
    }
    const url = typeof record.url === "string" ? record.url : "";
    if (url) {
      return `${cleanName} ${url}`;
    }
    const query = typeof record.query === "string" ? record.query : "";
    if (query) {
      return `${cleanName} ${query}`;
    }
  }

  return cleanName;
}

function formatToolResult(event: Extract<RunEvent, { type: "tool_result" }>): string {
  const name = event.name || "tool";
  const stdoutLen = event.stdoutLen ?? (event.stdout ? event.stdout.length : 0);
  const stderrLen = event.stderrLen ?? (event.stderr ? event.stderr.length : 0);
  const flags: string[] = [];
  if (event.isError) {
    flags.push("error");
  }
  if (event.interrupted) {
    flags.push("interrupted");
  }

  const summary = `${name} stdout=${stdoutLen}B stderr=${stderrLen}B${flags.length > 0 ? ` (${flags.join(",")})` : ""}`;

  const preview = (event.stdout || event.stderr || "").trim();
  if (!preview) {
    return summary;
  }

  const compact = preview.replace(/\s+/g, " ");
  const clipped = compact.length > 160 ? `${compact.slice(0, 160)}…` : compact;
  return `${summary} · ${clipped}`;
}

const MAX_DISCORD_FILE_SIZE = 25 * 1024 * 1024;

function appendInputFilesPrompt(
  prompt: string,
  inputFiles: string[],
  inputDir: string,
): string {
  if (inputFiles.length === 0) {
    return prompt;
  }

  const uniqueFiles = Array.from(new Set(inputFiles.map((filePath) => path.resolve(filePath)))).sort(
    (a, b) => a.localeCompare(b),
  );
  const lines = uniqueFiles.map((filePath) => `- ${toDisplayPath(filePath)}`);
  const inputSection = [
    "[Input Attachments]",
    `Input directory: ${path.resolve(inputDir)}`,
    "Files available for this turn:",
    ...lines,
    "These files are turn-scoped and will be deleted after this turn. Copy them to workspace if you need to keep them.",
  ].join("\n");

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return inputSection;
  }
  return `${trimmedPrompt}\n\n${inputSection}`;
}

function appendAttachmentSystemPrompt(
  systemPrompt: string,
  inputDir: string,
  outputDir: string,
): string {
  const restartDirectivePath = path.resolve(outputDir, RESTART_DIRECTIVE_FILE_NAME);
  const attachmentPolicy = [
    "[Attachment Bridge Rules]",
    `- User->Agent files are provided via "${path.resolve(inputDir)}".`,
    `- Agent->User files must be written to "${path.resolve(outputDir)}" before the turn ends.`,
    "- Input/output attachment files are deleted after each turn.",
    "- If a file must persist, copy it into the workspace directory.",
    `- If runtime restart is required after code changes, write JSON to "${restartDirectivePath}".`,
    "- Restart JSON example: {\"reason\":\"brief reason\",\"resumePrompt\":\"what to continue after restart\",\"delaySec\":3}",
  ].join("\n");

  const trimmedSystemPrompt = systemPrompt.trim();
  if (!trimmedSystemPrompt) {
    return attachmentPolicy;
  }
  return `${trimmedSystemPrompt}\n\n${attachmentPolicy}`;
}

function collectInputFiles(dirPath: string): string[] {
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) {
          continue;
        }
        files.push(path.resolve(fullPath));
      } catch (err: unknown) {
        console.error(`[queue] failed to stat input file ${fullPath}:`, err);
      }
    }
  } catch (err: unknown) {
    const nodeErr = err as { code?: string };
    if (nodeErr.code !== "ENOENT") {
      console.error("[queue] failed to read input dir:", err);
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function createTurnWorkspace(dataDir: string, taskKey: string, sequence: number): TurnWorkspace {
  const root = path.join(
    path.resolve(dataDir),
    "turn-work",
    `${Date.now()}-${process.pid}-${sequence}-${sanitizeForPath(taskKey).slice(0, 60)}`,
  );
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  return { rootDir: root, inputDir, outputDir };
}

function cleanupTurnWorkspace(workspace: TurnWorkspace): void {
  try {
    fs.rmSync(workspace.rootDir, { recursive: true, force: true });
  } catch (error: unknown) {
    console.error(`[queue] failed to cleanup turn workspace ${workspace.rootDir}:`, error);
  }
}

function moveStagedInputFiles(sourceDir: string, targetDir: string): string[] {
  fs.mkdirSync(targetDir, { recursive: true });
  const moved: string[] = [];

  try {
    const entries = fs.readdirSync(sourceDir).sort((a, b) => a.localeCompare(b));
    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry);
      try {
        const stat = fs.statSync(sourcePath);
        if (!stat.isFile()) {
          continue;
        }

        const safeName = sanitizeForPath(entry) || "input";
        const targetPath = buildUniqueFilePath(targetDir, safeName);
        moveFileWithFallback(sourcePath, targetPath);
        moved.push(path.resolve(targetPath));
      } catch (error: unknown) {
        const nodeErr = error as { code?: string };
        // Another turn may have moved/deleted this file already.
        if (nodeErr.code === "ENOENT") {
          continue;
        }
        console.error(`[queue] failed to move staged input ${sourcePath}:`, error);
      }
    }
  } catch (error: unknown) {
    const nodeErr = error as { code?: string };
    if (nodeErr.code !== "ENOENT") {
      console.error("[queue] failed to read staged input dir:", error);
    }
  }

  return moved.sort((a, b) => a.localeCompare(b));
}

function moveFileWithFallback(sourcePath: string, targetPath: string): void {
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error: unknown) {
    const nodeErr = error as { code?: string };
    if (nodeErr.code !== "EXDEV") {
      throw error;
    }
    fs.copyFileSync(sourcePath, targetPath);
    fs.unlinkSync(sourcePath);
  }
}

function buildUniqueFilePath(dirPath: string, fileName: string): string {
  const parsed = path.parse(fileName);
  const baseName = sanitizeForPath(parsed.name) || "file";
  const ext = sanitizeForPath(parsed.ext) || "";
  let attempt = 0;
  while (attempt < 1000) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const candidate = path.join(dirPath, `${baseName}${suffix}${ext}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    attempt += 1;
  }
  throw new Error(`Could not allocate unique file path for ${fileName}`);
}

function sanitizeForPath(value: string): string {
  return value.replace(/[/\\]/g, "_").replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "");
}

function toDisplayPath(filePath: string): string {
  const absPath = path.resolve(filePath);
  const rel = path.relative(process.cwd(), absPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return absPath;
  }
  return rel.replace(/\\/g, "/");
}

function collectOutputFiles(
  dirPath: string,
  options?: { skipNames?: Set<string> },
): AttachmentBuilder[] {
  const attachments: AttachmentBuilder[] = [];
  const skipNames = options?.skipNames;
  try {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      if (skipNames?.has(entry)) {
        continue;
      }
      const fullPath = path.join(dirPath, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) {
          continue;
        }
        if (stat.size > MAX_DISCORD_FILE_SIZE) {
          console.log(
            `[queue] skipping output file ${entry}: ${(stat.size / 1024 / 1024).toFixed(1)}MB exceeds 25MB limit`,
          );
          continue;
        }
        if (stat.size === 0) {
          continue;
        }
        attachments.push(
          new AttachmentBuilder(fullPath, { name: entry }),
        );
      } catch (err: unknown) {
        console.error(`[queue] failed to stat output file ${fullPath}:`, err);
      }
    }
  } catch (err: unknown) {
    const nodeErr = err as { code?: string };
    if (nodeErr.code !== "ENOENT") {
      console.error("[queue] failed to read output dir:", err);
    }
  }
  if (attachments.length > 0) {
    console.log(
      `[queue] collected ${attachments.length} output file(s): ${attachments.map((a) => a.name).join(", ")}`,
    );
  }
  return attachments;
}

async function downloadAttachments(
  attachments: DiscordAttachmentInfo[],
  inputDir: string,
): Promise<string[]> {
  fs.mkdirSync(inputDir, { recursive: true });
  const downloaded: string[] = [];

  for (const att of attachments) {
    if (att.size > MAX_DISCORD_FILE_SIZE) {
      console.log(
        `[queue] skipping input attachment ${att.name}: ${(att.size / 1024 / 1024).toFixed(1)}MB exceeds 25MB limit`,
      );
      continue;
    }

    try {
      const response = await fetch(att.url);
      if (!response.ok) {
        console.error(
          `[queue] failed to download attachment ${att.name}: HTTP ${response.status}`,
        );
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const safeName = sanitizeForPath(att.name) || "attachment";
      const destPath = buildUniqueFilePath(inputDir, safeName);
      fs.writeFileSync(destPath, buffer);
      downloaded.push(path.resolve(destPath));
      console.log(
        `[queue] downloaded attachment ${path.basename(destPath)} (${(att.size / 1024).toFixed(1)}KB)`,
      );
    } catch (err: unknown) {
      console.error(`[queue] failed to download attachment ${att.name}:`, err);
    }
  }

  return downloaded;
}

function resolveContextId(
  channel: Message["channel"] | ChatInputCommandInteraction["channel"],
  userId: string,
): string {
  if (!channel) {
    return `dm_${userId}`;
  }

  const channelLike = channel as {
    id: string;
    isDMBased?: () => boolean;
    isThread?: () => boolean;
  };

  if (typeof channelLike.isDMBased === "function" && channelLike.isDMBased()) {
    return `dm_${userId}`;
  }
  if (typeof channelLike.isThread === "function" && channelLike.isThread()) {
    return `th_${channelLike.id}`;
  }
  return `ch_${channelLike.id}`;
}

const ROTATION_SUMMARY_PROMPT = `You are about to be rotated to a new session because the current context window is nearly full.
Please generate a comprehensive summary of this conversation that will be injected into the new session.

Your summary MUST include:
1. User identity and context
2. Key topics discussed
3. Decisions made
4. Current task state (latest request, progress, remaining work)
5. Important details (file paths, code, URLs, names, numbers)
6. Tone and preferences
7. Open threads / unresolved items

Write ONLY the summary. No preamble or meta-commentary.`;

const ROTATION_NOTICE =
  "---\n*세션이 컨텍스트 윈도우 한계에 도달하여 자동으로 교체되었습니다. 대화 요약이 저장되었으며, 다음 메시지부터 새 세션에서 계속됩니다.*";

function buildRotationSummaryXml(summary: string): string {
  return `<session_rotation_context>
<note>This is a continuation of a previous conversation. The previous session was automatically rotated due to context window limits.</note>
<previous_session_summary>
${summary}
</previous_session_summary>
</session_rotation_context>`;
}
