import type { Client, TextBasedChannel } from "discord.js";
import type { Config } from "../utils/config.js";
import type { PersonaManager } from "./persona-manager.js";
import type { QueueManager } from "./queue-manager.js";
import type { SessionManager } from "./session-manager.js";

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type HeartbeatStatus =
  | "ok"
  | "alert"
  | "skipped-disabled"
  | "skipped-no-channel"
  | "skipped-outside-hours"
  | "skipped-busy"
  | "skipped-empty-checklist"
  | "failed";

export interface HeartbeatEvent {
  ts: number;
  status: HeartbeatStatus;
  durationMs?: number;
  preview?: string;
}

export interface HeartbeatSnapshot {
  enabled: boolean;
  channelId: string;
  intervalMinutes: number;
  activeHours: { start: number; end: number };
  lastEvent: HeartbeatEvent | null;
  runCount: number;
}

export class HeartbeatManager {
  private timer: NodeJS.Timeout | null = null;
  private alignTimer: NodeJS.Timeout | null = null;
  private running = false;
  private lastEvent: HeartbeatEvent | null = null;
  private lastDeliveredText = "";
  private lastDeliveredAt = 0;
  private runCount = 0;

  constructor(
    private readonly client: Client,
    private readonly config: Config,
    private readonly personas: PersonaManager,
    private readonly queue: QueueManager,
    private readonly sessions: SessionManager,
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    if (!this.config.heartbeatEnabled) {
      console.log("[heartbeat] disabled via config");
      return;
    }
    if (!this.config.heartbeatChannelId) {
      console.warn("[heartbeat] HEARTBEAT_CHANNEL_ID not set, heartbeat disabled");
      return;
    }

    const intervalMs = this.config.heartbeatIntervalMinutes * 60 * 1000;
    console.log(
      `[heartbeat] started interval=${this.config.heartbeatIntervalMinutes}m channel=${this.config.heartbeatChannelId} activeHours=${this.config.heartbeatActiveHoursStart}-${this.config.heartbeatActiveHoursEnd}`,
    );

    // Align execution to the clock so heartbeats fire at fixed wall-clock
    // times (e.g. every hour on the hour) regardless of when the process starts.
    const msUntilNextSlot = this.msUntilNextAlignedSlot(intervalMs);
    console.log(
      `[heartbeat] next aligned run in ${Math.round(msUntilNextSlot / 1000)}s`,
    );

    this.alignTimer = setTimeout(() => {
      this.alignTimer = null;
      void this.runSafely();

      // After the first aligned run, use setInterval for subsequent runs.
      this.timer = setInterval(() => {
        void this.runSafely();
      }, intervalMs);
      this.timer.unref?.();
    }, msUntilNextSlot);
    this.alignTimer.unref?.();
  }

  stop(): void {
    if (this.alignTimer) {
      clearTimeout(this.alignTimer);
      this.alignTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getSnapshot(): HeartbeatSnapshot {
    return {
      enabled: this.config.heartbeatEnabled,
      channelId: this.config.heartbeatChannelId,
      intervalMinutes: this.config.heartbeatIntervalMinutes,
      activeHours: {
        start: this.config.heartbeatActiveHoursStart,
        end: this.config.heartbeatActiveHoursEnd,
      },
      lastEvent: this.lastEvent,
      runCount: this.runCount,
    };
  }

  /** Trigger a heartbeat run on demand (e.g. from a slash command). */
  async triggerNow(): Promise<HeartbeatEvent> {
    return await this.run();
  }

  private async runSafely(): Promise<void> {
    if (this.running) {
      console.warn("[heartbeat] skipped because a previous run is still in progress");
      return;
    }
    this.running = true;
    try {
      await this.run();
    } catch (error: unknown) {
      console.error("[heartbeat] unexpected error:", error);
      this.recordEvent({ ts: Date.now(), status: "failed" });
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<HeartbeatEvent> {
    this.runCount += 1;

    // 1. Check if enabled
    if (!this.config.heartbeatEnabled) {
      const event: HeartbeatEvent = { ts: Date.now(), status: "skipped-disabled" };
      this.recordEvent(event);
      return event;
    }

    // 2. Check channel availability
    const channel = await this.resolveChannel();
    if (!channel) {
      const event: HeartbeatEvent = { ts: Date.now(), status: "skipped-no-channel" };
      console.warn(`[heartbeat] channel ${this.config.heartbeatChannelId} unavailable`);
      this.recordEvent(event);
      return event;
    }

    // 3. Check active hours
    if (!this.isWithinActiveHours()) {
      const event: HeartbeatEvent = { ts: Date.now(), status: "skipped-outside-hours" };
      console.log(
        `[heartbeat] skipped: outside active hours (${this.config.heartbeatActiveHoursStart}-${this.config.heartbeatActiveHoursEnd}, current=${new Date().getHours()})`,
      );
      this.recordEvent(event);
      return event;
    }

    // 4. Check if queue is busy
    if (this.queue.isBusy) {
      const event: HeartbeatEvent = { ts: Date.now(), status: "skipped-busy" };
      console.log("[heartbeat] skipped: queue is busy");
      this.recordEvent(event);
      return event;
    }

    // 5. Read HEARTBEAT.md
    const checklist = this.personas.getHeartbeatContent().trim();
    const hasSubstantive = this.hasSubstantiveContent(checklist);
    if (!hasSubstantive) {
      const event: HeartbeatEvent = { ts: Date.now(), status: "skipped-empty-checklist" };
      console.log("[heartbeat] skipped: HEARTBEAT.md has no substantive content");
      this.recordEvent(event);
      return event;
    }

    // 6. Build heartbeat prompt
    const prompt = this.buildHeartbeatPrompt(checklist);

    // 7. Enqueue the heartbeat task
    const startedAt = Date.now();
    const contextId = `ch_${channel.id}`;
    const heartbeatUserId = "heartbeat:system";
    const sessionId = this.sessions.getSession(heartbeatUserId, contextId, "claude");

    return await new Promise<HeartbeatEvent>((resolve) => {
      const taskKey = `heartbeat:${channel.id}`;

      // We need to intercept the response. Use a wrapper channel approach:
      // enqueue with a channel target and then inspect the result via events.
      // Since QueueManager handles everything, we enqueue and wait for completion
      // by polling. But a simpler approach: just use the queue directly.

      const result = this.queue.enqueue({
        prompt,
        sessionId,
        sessionUserId: heartbeatUserId,
        model: "claude-sonnet-4-6",
        taskKey,
        respondTo: { type: "channel", channel: new HeartbeatInterceptChannel(channel, this, startedAt, resolve) as unknown as TextBasedChannel },
        createdAt: Date.now(),
        engine: "claude",
        modeName: "default",
      });

      if (!result.accepted) {
        const event: HeartbeatEvent = {
          ts: Date.now(),
          status: "skipped-busy",
        };
        console.log(`[heartbeat] enqueue rejected: ${result.reason}`);
        this.recordEvent(event);
        resolve(event);
      } else {
        console.log(`[heartbeat] enqueued task key=${taskKey}`);
      }
    });
  }

  /** Called by HeartbeatInterceptChannel when the response arrives. */
  handleResponse(
    text: string,
    channel: TextBasedChannel,
    startedAt: number,
  ): HeartbeatEvent {
    const durationMs = Date.now() - startedAt;
    const stripped = stripHeartbeatToken(text);

    // Check if it's an OK acknowledgment
    if (isHeartbeatOk(text)) {
      const event: HeartbeatEvent = { ts: Date.now(), status: "ok", durationMs };
      console.log(`[heartbeat] ok (nothing to report) durationMs=${durationMs}`);
      this.recordEvent(event);
      return event;
    }

    // Check for duplicate within 24h
    if (stripped === this.lastDeliveredText && Date.now() - this.lastDeliveredAt < DEDUP_WINDOW_MS) {
      const event: HeartbeatEvent = { ts: Date.now(), status: "ok", durationMs, preview: stripped.slice(0, 100) };
      console.log(`[heartbeat] dedup: same content within 24h, skipping delivery`);
      this.recordEvent(event);
      return event;
    }

    // Deliver the alert to the channel
    this.lastDeliveredText = stripped;
    this.lastDeliveredAt = Date.now();

    const event: HeartbeatEvent = {
      ts: Date.now(),
      status: "alert",
      durationMs,
      preview: stripped.slice(0, 200),
    };
    console.log(`[heartbeat] alert delivered durationMs=${durationMs} preview="${event.preview}"`);
    this.recordEvent(event);
    return event;
  }

  private buildHeartbeatPrompt(checklist: string): string {
    return [
      "이것은 주기적 자율 점검(heartbeat)입니다.",
      "",
      "아래 HEARTBEAT.md 체크리스트를 읽고, 확인이 필요한 항목이 있는지 점검하세요.",
      "보고할 내용이 없으면 정확히 `HEARTBEAT_OK`라고만 답하세요.",
      "보고할 내용이 있으면 간결하게 요약해서 전달하세요.",
      "",
      "---",
      checklist,
    ].join("\n");
  }

  /**
   * Calculate ms until the next wall-clock slot aligned to `intervalMs`.
   * E.g. with a 60-minute interval, the next slot is the next full hour.
   * With a 30-minute interval, slots are :00 and :30 of every hour.
   * Adds a small 10-second buffer so the bot is fully ready.
   */
  private msUntilNextAlignedSlot(intervalMs: number): number {
    const now = Date.now();
    const elapsed = now % intervalMs;
    const remaining = intervalMs - elapsed;
    // Add a small buffer (10s) to avoid edge-case races at exact boundaries.
    const buffer = 10_000;
    return remaining + buffer;
  }

  private isWithinActiveHours(): boolean {
    const hour = new Date().getHours();
    const { heartbeatActiveHoursStart: start, heartbeatActiveHoursEnd: end } = this.config;

    // 0-24 means always active
    if (start === 0 && end === 24) {
      return true;
    }

    // Handle wraparound (e.g. 22-6 means 22:00 to 06:00)
    if (start <= end) {
      return hour >= start && hour < end;
    }
    return hour >= start || hour < end;
  }

  private async resolveChannel(): Promise<TextBasedChannel | null> {
    try {
      const channel = await this.client.channels.fetch(this.config.heartbeatChannelId);
      if (!channel || !channel.isTextBased()) {
        return null;
      }
      return channel;
    } catch {
      return null;
    }
  }

  private hasSubstantiveContent(text: string): boolean {
    if (!text) {
      return false;
    }
    const stripped = text
      .replace(/<!--[\s\S]*?-->/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    return stripped.length > 0;
  }

  private recordEvent(event: HeartbeatEvent): void {
    this.lastEvent = event;
  }
}

/**
 * A proxy channel that intercepts `send()` calls from QueueManager
 * to inspect the heartbeat response before deciding whether to actually deliver it.
 *
 * On the first chunk we decide the disposition (ok / dedup / alert).
 * For alerts, all chunks are forwarded to the real channel.
 * For ok/dedup, all chunks are swallowed silently.
 */
class HeartbeatInterceptChannel {
  readonly id: string;
  private decided = false;
  private disposition: HeartbeatStatus = "ok";

  constructor(
    private readonly realChannel: TextBasedChannel,
    private readonly manager: HeartbeatManager,
    private readonly startedAt: number,
    private readonly resolve: (event: HeartbeatEvent) => void,
  ) {
    this.id = realChannel.id;
  }

  async send(options: { content?: string; files?: unknown[] }): Promise<unknown> {
    const text = (options.content || "").trim();

    if (!this.decided) {
      this.decided = true;
      const event = this.manager.handleResponse(text, this.realChannel, this.startedAt);
      this.disposition = event.status;
      this.resolve(event);
    }

    if (this.disposition === "alert") {
      const realSend = (this.realChannel as { send?: (opts: unknown) => Promise<unknown> }).send;
      if (typeof realSend === "function") {
        return await realSend.call(this.realChannel, options);
      }
    }

    return null;
  }

  async sendTyping(): Promise<void> {
    const ch = this.realChannel as { sendTyping?: () => Promise<void> };
    if (typeof ch.sendTyping === "function") {
      await ch.sendTyping();
    }
  }
}

function stripHeartbeatToken(text: string): string {
  return text
    .replace(/^\s*HEARTBEAT_OK\s*/i, "")
    .replace(/\s*HEARTBEAT_OK\s*$/i, "")
    .trim();
}

function isHeartbeatOk(text: string): boolean {
  const stripped = stripHeartbeatToken(text);
  return stripped.length === 0;
}
