import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MessageFlags,
  MessageType,
  type Client,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import { createClient, createContext, type BotContext } from "./bot.js";
import { commands, registerCommands } from "./commands/index.js";
import { resolveContextIdFromMessage } from "./core/context-id.js";
import type { DiscordAttachmentInfo } from "./core/queue-manager.js";
import { isApprovalMessage } from "./core/team-manager.js";
import { checkAccess } from "./utils/access-control.js";
import { formatQueueStatus } from "./utils/formatter.js";
import { loadConfig } from "./utils/config.js";

const MESSAGE_EVENT_DEDUP_WINDOW_MS = 2 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();
  const releaseLock = acquireSingleInstanceLock(resolveRuntimeLockPath());
  const client = createClient(config);
  const ctx = await createContext(config, client);

  client.on("error", (error) => {
    // Prevent the process from crashing when async event handlers reject.
    console.error("[discord] client error:", error);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = commands.find((entry) => {
      const data = Array.isArray(entry.data) ? entry.data : [entry.data];
      return data.some((item) => item.name === interaction.commandName);
    });

    if (!command) {
      return;
    }

    try {
      await command.execute(interaction, ctx);
    } catch (error: unknown) {
      console.error("Command error:", error);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: "명령어 처리 중 오류가 발생했습니다.",
            flags: MessageFlags.Ephemeral,
          });
        } else {
          await interaction.reply({
            content: "명령어 처리 중 오류가 발생했습니다.",
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (replyError: unknown) {
        console.error("Failed to send command error response:", replyError);
      }
    }
  });

  client.on("messageCreate", async (message) => {
    try {
      if (!ctx.config.enableMentionResponse) {
        return;
      }

      // Only treat real user-authored messages as prompts.
      // Discord emits non-default message types (system notifications, slash command invocation stubs, etc.)
      // and replying to those can error with "Cannot reply to a system message".
      if (message.type == null) {
        return;
      }
      if (message.type !== MessageType.Default && message.type !== MessageType.Reply) {
        return;
      }

      // Defensive guard: ignore bot/app/webhook authored messages to avoid self-trigger loops.
      if (
        message.author.bot ||
        message.author.system ||
        (client.user && message.author.id === client.user.id) ||
        Boolean(message.webhookId) ||
        Boolean(message.applicationId)
      ) {
        return;
      }
      if (!client.user) {
        return;
      }
      let isMentioned = message.mentions.has(client.user);

      // Team pipeline approval check (before mention requirement)
      const pendingRun = ctx.team.getPendingApproval(message.channelId, message.author.id);
      if (pendingRun && isApprovalMessage(message.content.trim())) {
        if (!ctx.sessions.claimMessageEvent(message.id, MESSAGE_EVENT_DEDUP_WINDOW_MS)) {
          console.log(`[message] duplicate approval event messageId=${message.id} ignored`);
          return;
        }

        try {
          await ctx.team.handleApproval(message.channelId, message.author.id, ctx);
          await safeReply(message, "파이프라인 시작합니다.");
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : String(error);
          await safeReply(message, `파이프라인 시작 실패: ${errMsg}`);
        }
        return;
      }

      // If mention is required, treat replies to the bot's message as "addressed to the bot"
      // to support interactive back-and-forth without @mentions.
      if (ctx.config.requireMention && !isMentioned && message.reference?.messageId) {
        try {
          const channelWithMessages = message.channel as unknown as {
            messages?: { fetch?: (id: string) => Promise<unknown> };
          };
          const fetch = channelWithMessages.messages?.fetch;
          if (typeof fetch === "function") {
            const referenced = (await fetch.call(
              channelWithMessages.messages,
              message.reference.messageId,
            )) as Message | null;
            if (referenced?.author?.id && referenced.author.id === client.user.id) {
              isMentioned = true;
            }
          }
        } catch {
          // ignore
        }
      }

      if (ctx.config.requireMention && !isMentioned) {
        return;
      }

      const access = checkAccess(ctx.config, message.author.id, message.channelId);
      if (!access.allowed) {
        return;
      }

      const attachments: DiscordAttachmentInfo[] = [];
      for (const [, att] of message.attachments) {
        attachments.push({
          url: att.url,
          name: att.name ?? "file",
          size: att.size,
          contentType: att.contentType,
        });
      }

      const prompt = isMentioned
        ? message.content.replace(/<@!?\d+>/g, "").trim()
        : message.content.trim();
      if (!prompt && attachments.length === 0) {
        console.log("[message] ignored empty prompt");
        return;
      }

      if (!ctx.sessions.claimMessageEvent(message.id, MESSAGE_EVENT_DEDUP_WINDOW_MS)) {
        console.log(`[message] duplicate event messageId=${message.id} ignored`);
        return;
      }

      const contextId = resolveContextIdFromMessage(message);
      const userId = message.author.id;
      const taskKey = `${userId}:${contextId}`;
      const engine = ctx.engines.getEngine(userId, contextId);
      const effectiveEngine = ctx.runners.has(engine) ? engine : "claude";
      const model = ctx.models.getModel(userId, contextId, effectiveEngine);
      console.log(
        `[message] enqueue request messageId=${message.id} user=${userId} channel=${message.channelId} key=${taskKey} model=${model || "(default)"} engine=${effectiveEngine} promptLen=${prompt.length} attachments=${attachments.length} mentioned=${isMentioned}`,
      );
      const sessionId = ctx.sessions.getSession(userId, contextId, effectiveEngine);

      const effectivePrompt =
        prompt || (attachments.length > 0 ? "첨부된 파일을 확인해줘." : "");

      // If a request is already in-flight for this conversation, allow quick status probes
      // (e.g. "야 뭐하냐") without interrupting or enqueueing.
      if (
        attachments.length === 0 &&
        ctx.queue.hasTask(taskKey) &&
        isStatusProbe(effectivePrompt)
      ) {
        const current = ctx.queue.getTaskSnapshot(taskKey);
        if (current) {
          const live = ctx.queue.getLiveSnapshot(taskKey);
          if (live?.content) {
            await safeReply(message, live.content.slice(0, 1990));
            return;
          }

          const modelText = current.model ? ` model=${current.model}` : "";
          await safeReply(
            message,
            `작업 중 (${current.engine}${modelText}) · 경과 ${(current.elapsedMs / 1000).toFixed(0)}초`,
          );
          return;
        }

        const pos = ctx.queue.positionOf(taskKey);
        await safeReply(message, `⏳ 아직 실행 전입니다. 대기열 ${pos}번째.`);
        return;
      }

      const enqueueResult = ctx.queue.enqueue({
        prompt: effectivePrompt,
        sessionId,
        model,
        taskKey,
        respondTo: { type: "message", message },
        createdAt: Date.now(),
        engine: effectiveEngine,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (!enqueueResult.accepted) {
        if (enqueueResult.reason === "duplicate") {
          console.log(`[message] duplicate key=${taskKey}`);
          await safeReply(
            message,
            "이 대화는 이미 처리 중입니다. 이전 응답이 끝난 뒤 다시 보내주세요.",
          );
          return;
        }

        console.log(`[message] queue_full key=${taskKey}`);
        await safeReply(
          message,
          `대기열이 가득 찼습니다 (${ctx.config.maxQueueSize}개). 잠시 후 다시 시도해주세요.`,
        );
        return;
      }

      if (enqueueResult.position > 1) {
        await safeReply(message, formatQueueStatus(enqueueResult.position));
      }
    } catch (error: unknown) {
      console.error("[message] handler failed:", error);
    }
  });

  client.once("ready", async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
    await registerCommands(readyClient.user.id, ctx.config.discordToken);
    console.log("Slash commands registered");
    ctx.schedules.start();
    ctx.heartbeat.start();
    ctx.ptyRelay.start();

    const cleaned = ctx.sessions.cleanupOldSessions();
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} old sessions`);
    }

    const cleanedSummaries = ctx.sessions.cleanupOldSummaries();
    if (cleanedSummaries > 0) {
      console.log(`Cleaned up ${cleanedSummaries} old session summaries`);
    }

    await resumePendingRestartTask(ctx, readyClient);
  });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log("Shutting down...");

    try {
      ctx.ptyRelay.stop();
      ctx.heartbeat.stop();
      ctx.schedules.stop();
      ctx.sessions.close();
      ctx.personas.close();
    } catch (error: unknown) {
      console.error("Failed to close runtime resources:", error);
    }

    client.destroy();
    releaseLock();
    process.exitCode = 0;
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await client.login(ctx.config.discordToken);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function resumePendingRestartTask(ctx: BotContext, client: Client): Promise<void> {
  const pending = ctx.restarts.peekPendingResume();
  if (!pending) {
    return;
  }

  let fetchedChannel: unknown;
  try {
    fetchedChannel = await client.channels.fetch(pending.channelId);
  } catch (error: unknown) {
    console.error(`[restart] failed to fetch channel ${pending.channelId}:`, error);
    return;
  }
  if (!fetchedChannel) {
    console.error(`[restart] channel not found: ${pending.channelId}`);
    ctx.restarts.clearPendingResume();
    return;
  }

  const channel = fetchedChannel as TextBasedChannel;
  const send = (channel as unknown as { send?: (value: unknown) => Promise<unknown> }).send;
  if (typeof send !== "function") {
    console.error(`[restart] channel ${pending.channelId} is not sendable`);
    ctx.restarts.clearPendingResume();
    return;
  }

  try {
    await send.call(
      channel,
      "서버 재시작 완료, 수정 코드 반영 확인. 이전 세션 자동 재개를 시작합니다.",
    );
  } catch (error: unknown) {
    console.error(`[restart] failed to send resume preface to ${pending.channelId}:`, error);
    return;
  }

  const taskKey = `restart-resume:${pending.id}`;
  const enqueue = ctx.queue.enqueue({
    prompt: pending.resumePrompt,
    sessionId: pending.sessionId,
    sessionUserId: pending.sessionUserId,
    mechoModeId: pending.mechoModeId || undefined,
    model: pending.model,
    taskKey,
    respondTo: { type: "channel", channel },
    createdAt: Date.now(),
    engine: pending.engine,
    modeName: pending.modeName || undefined,
  });

  if (enqueue.accepted) {
    ctx.restarts.clearPendingResume();
    console.log(
      `[restart] resumed pending task id=${pending.id} channel=${pending.channelId} key=${taskKey}`,
    );
    return;
  }

  try {
    await send.call(
      channel,
      `자동 재개 enqueue 실패: ${enqueue.reason} (taskKey=${taskKey})`,
    );
  } catch (error: unknown) {
    console.error(`[restart] failed to send enqueue failure to ${pending.channelId}:`, error);
  }
  console.error(
    `[restart] failed to enqueue pending resume id=${pending.id} reason=${enqueue.reason}`,
  );
}

function acquireSingleInstanceLock(lockPath: string): () => void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const payload = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
  });

  const tryCreate = (): boolean => {
    try {
      fs.writeFileSync(lockPath, payload, { encoding: "utf8", flag: "wx" });
      return true;
    } catch (error: unknown) {
      const nodeError = asNodeError(error);
      if (nodeError.code !== "EEXIST") {
        throw error;
      }
      return false;
    }
  };

  if (!tryCreate()) {
    const existingPid = readLockPid(lockPath);
    if (existingPid && isProcessAlive(existingPid)) {
      throw new Error(
        `이미 실행 중인 봇 인스턴스가 있습니다 (pid=${existingPid}). 중복 실행을 중단합니다.`,
      );
    }

    try {
      fs.unlinkSync(lockPath);
    } catch (error: unknown) {
      const nodeError = asNodeError(error);
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
    }

    if (!tryCreate()) {
      throw new Error("락 파일을 생성할 수 없습니다. bot.lock을 확인해주세요.");
    }
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    try {
      fs.unlinkSync(lockPath);
    } catch (error: unknown) {
      const nodeError = asNodeError(error);
      if (nodeError.code !== "ENOENT") {
        console.error("Failed to release bot lock:", error);
      }
    }
  };
}

function resolveRuntimeLockPath(): string {
  const entryDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(entryDir, "..");
  return path.join(projectRoot, ".runtime", "bot.lock");
}

function readLockPid(lockPath: string): number | null {
  try {
    const content = fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(content) as { pid?: unknown };
    const pid = Number(parsed.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface NodeErrorLike {
  code?: string;
}

function asNodeError(error: unknown): NodeErrorLike {
  if (typeof error === "object" && error !== null) {
    return error as NodeErrorLike;
  }
  return {};
}

function isStatusProbe(text: string): boolean {
  const raw = text.trim();
  if (!raw) {
    return false;
  }

  // Keep this conservative: short, "status-like" messages only.
  if (raw.length > 40) {
    return false;
  }

  const compact = raw.toLowerCase().replace(/\s+/g, "");
  const needles = [
    "status",
    "progress",
    "update",
    "whatareyoudoing",
    "whatreyoudoing",
    "whatdoing",
    "wyd",
    "뭐하",
    "뭐해",
    "진행",
    "상황",
    "어디까지",
    "얼마나",
  ];
  return needles.some((n) => compact.includes(n));
}

async function safeReply(message: Message, content: string): Promise<void> {
  const trimmed = content.length > 1990 ? `${content.slice(0, 1990)}…` : content;

  try {
    // Reply only to normal messages; other types can error with "Cannot reply to a system message".
    if (message.type === MessageType.Default || message.type === MessageType.Reply) {
      await message.reply(trimmed);
      return;
    }
  } catch (error: unknown) {
    console.warn("[discord] message.reply failed, fallback to channel.send:", error);
  }

  const channel = message.channel as unknown as { send?: (value: unknown) => Promise<unknown> };
  if (typeof channel.send !== "function") {
    return;
  }

  try {
    await channel.send(trimmed);
  } catch (error: unknown) {
    console.error("[discord] channel.send failed:", error);
  }
}
