import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { BotContext } from "../bot.js";
import { loadConfig } from "../utils/config.js";

const sessionsCommand = new SlashCommandBuilder()
  .setName("sessions")
  .setDescription("Show active session list");

const reloadCommand = new SlashCommandBuilder()
  .setName("reload")
  .setDescription("Reload runtime config");

const queueCommand = new SlashCommandBuilder()
  .setName("queue")
  .setDescription("Show current queue status");

const heartbeatCommand = new SlashCommandBuilder()
  .setName("heartbeat")
  .setDescription("Show heartbeat status or trigger one run")
  .addSubcommand((subcommand) =>
    subcommand.setName("status").setDescription("Show heartbeat status"),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("trigger").setDescription("Trigger heartbeat now"),
  );

export const data = [sessionsCommand, reloadCommand, queueCommand, heartbeatCommand];

type ReplyPayload = Parameters<ChatInputCommandInteraction["reply"]>[0];

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<void> {
  if (interaction.user.id !== ctx.config.ownerId) {
    await sendReply(interaction, {
      content: "Owner only command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "sessions") {
    await handleSessions(interaction, ctx);
    return;
  }

  if (interaction.commandName === "reload") {
    await handleReload(interaction, ctx);
    return;
  }

  if (interaction.commandName === "queue") {
    await handleQueue(interaction, ctx);
    return;
  }

  if (interaction.commandName === "heartbeat") {
    await handleHeartbeat(interaction, ctx);
  }
}

async function handleSessions(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<void> {
  const list = ctx.sessions.listSessions();
  if (list.length === 0) {
    await sendReply(interaction, {
      content: "No active sessions.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = list.slice(0, 30).map((session, index) => {
    const createdAt = `<t:${Math.floor(session.createdAt / 1000)}:f>`;
    const lastUsedAt = `<t:${Math.floor(session.lastUsedAt / 1000)}:R>`;
    return `${index + 1}. \`${session.contextId}\` | \`${session.engine}\` | \`${session.sessionId.slice(
      0,
      8,
    )}\` | ${createdAt} | ${lastUsedAt} | ${session.messageCount}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("Sessions")
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({ text: `Total ${list.length}` });

  await sendReply(interaction, {
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleReload(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<void> {
  const next = loadConfig();
  Object.assign(ctx.config, next);
  ctx.personas.invalidateCache();

  await sendReply(interaction, {
    content: "Configuration reloaded.",
    flags: MessageFlags.Ephemeral,
  });
}

async function handleQueue(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<void> {
  const { queue, config } = ctx;
  const processingText = queue.isBusy ? "yes" : "no";
  const current = queue.getCurrentTaskSnapshot();
  const pendingKeys = queue.listPendingTaskKeys(5);

  const content = [
    `Processing: ${processingText}`,
    `Active runs: ${queue.activeRunCount}`,
    `Pending: ${queue.pendingCount}`,
    `In-flight total: ${queue.totalInFlightCount}`,
    `Max queue size: ${config.maxQueueSize}`,
    `Max concurrent runs: ${config.maxConcurrentRuns}`,
    current
      ? [
          "",
          `Current task: \`${current.taskKey}\``,
          `- engine: ${current.engine}`,
          `- respondTo: ${current.respondToType}`,
          `- waited: ${formatDuration(current.waitMs)}`,
          `- elapsed: ${formatDuration(current.elapsedMs)}`,
        ].join("\n")
      : "",
    pendingKeys.length > 0
      ? ["", "Pending keys (max 5):", ...pendingKeys.map((k) => `- \`${k}\``)].join("\n")
      : "",
  ].join("\n");

  await sendReply(interaction, {
    content: content.slice(0, 1900),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleHeartbeat(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "status") {
    const snap = ctx.heartbeat.getSnapshot();
    const lastStatus = snap.lastEvent
      ? `${snap.lastEvent.status} (<t:${Math.floor(snap.lastEvent.ts / 1000)}:R>)`
      : "none";
    const content = [
      `Enabled: ${snap.enabled ? "yes" : "no"}`,
      `Channel: ${snap.channelId || "(unset)"}`,
      `Interval: ${snap.intervalMinutes}m`,
      `Active hours: ${snap.activeHours.start}-${snap.activeHours.end}`,
      `Runs: ${snap.runCount}`,
      `Last: ${lastStatus}`,
      snap.lastEvent?.preview ? `Preview: ${snap.lastEvent.preview.slice(0, 200)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await sendReply(interaction, {
      content: content.slice(0, 1900),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "trigger") {
    if (!ctx.config.heartbeatEnabled) {
      await sendReply(interaction, {
        content: "Heartbeat is disabled. Set HEARTBEAT_ENABLED=true.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await sendReply(interaction, {
      content: "Triggering heartbeat...",
      flags: MessageFlags.Ephemeral,
    });

    const event = await ctx.heartbeat.triggerNow();
    const summary = `Done: ${event.status}${event.durationMs ? ` (${formatDuration(event.durationMs)})` : ""}${event.preview ? `\n${event.preview.slice(0, 300)}` : ""}`;

    await interaction.followUp({
      content: summary.slice(0, 1900),
      flags: MessageFlags.Ephemeral,
    });
  }
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `${hours}h${minutes}m${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }
  return `${seconds}s`;
}

async function sendReply(
  interaction: ChatInputCommandInteraction,
  payload: ReplyPayload,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload);
    return;
  }
  await interaction.reply(payload);
}
