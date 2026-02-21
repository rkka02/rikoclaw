import {
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { BotContext } from "../bot.js";
import type { ScheduleMutationResult } from "../core/schedule-manager.js";

export const data = new SlashCommandBuilder()
  .setName("schedule")
  .setDescription("Manage automatic schedules")
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("List loaded schedules"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("Add a schedule")
      .addStringOption((option) =>
        option
          .setName("id")
          .setDescription("Unique schedule id")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("cron")
          .setDescription("Cron expression (5 fields, KST)")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("prompt")
          .setDescription("Prompt to run")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("mode_id")
          .setDescription("Mecho mode id (optional; letters/numbers/_/-)")
          .setRequired(false),
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Target channel (defaults to current channel)")
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread,
          )
          .setRequired(false),
      )
      .addStringOption((option) =>
        option
          .setName("mode")
          .setDescription("Mode name (default: default)")
          .setRequired(false),
      )
      .addBooleanOption((option) =>
        option
          .setName("enabled")
          .setDescription("Whether the schedule is enabled")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("toggle")
      .setDescription("Toggle a schedule by id")
      .addStringOption((option) =>
        option
          .setName("id")
          .setDescription("Schedule id or key")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("Remove a schedule by id")
      .addStringOption((option) =>
        option
          .setName("id")
          .setDescription("Schedule id or key")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("run")
      .setDescription("Run a schedule immediately")
      .addStringOption((option) =>
        option
          .setName("id")
          .setDescription("Schedule id or key")
          .setRequired(true),
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<void> {
  if (interaction.user.id !== ctx.config.ownerId) {
    await interaction.reply({
      content: "Only the owner can manage schedules.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "list") {
    const items = ctx.schedules.listSchedules();
    if (items.length === 0) {
      await interaction.reply({
        content: "No schedules found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = items.map(
      (item) =>
        `- \`${item.key}\` (${item.enabled ? "on" : "off"}) cron=\`${item.cron}\` tz=\`KST\` mode=\`${item.modeName}\` mode_id=\`${item.modeId || "context-default"}\` channel=<#${item.channelId}> source=\`${item.source}\``,
    );
    await interaction.reply({
      content: lines.join("\n").slice(0, 1900),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "add") {
    const id = interaction.options.getString("id", true).trim();
    const cron = interaction.options.getString("cron", true).trim();
    const prompt = interaction.options.getString("prompt", true).trim();
    const modeId = interaction.options.getString("mode_id")?.trim() || undefined;
    const modeName = interaction.options.getString("mode")?.trim() || undefined;
    const enabled = interaction.options.getBoolean("enabled") ?? true;

    const channel = interaction.options.getChannel("channel");
    const channelId = channel?.id || interaction.channelId;
    if (!channelId) {
      await interaction.reply({
        content: "Cannot resolve target channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = ctx.schedules.addSchedule({
      id,
      cron,
      channelId,
      prompt,
      modeId,
      modeName,
      enabled,
    });

    await interaction.reply({
      content: formatMutationResult(result),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "toggle") {
    const id = interaction.options.getString("id", true).trim();
    const result = ctx.schedules.toggleSchedule(id);

    await interaction.reply({
      content: formatMutationResult(result),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "remove") {
    const id = interaction.options.getString("id", true).trim();
    const result = ctx.schedules.removeSchedule(id);

    await interaction.reply({
      content: formatMutationResult(result),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "run") {
    const id = interaction.options.getString("id", true).trim();
    const result = await ctx.schedules.runScheduleNow(id);

    await interaction.reply({
      content: formatMutationResult(result),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}

function formatMutationResult(result: ScheduleMutationResult): string {
  if (result.ok) {
    return result.message;
  }

  if (result.error === "ambiguous" && result.candidates && result.candidates.length > 0) {
    return `${result.message}\n${result.candidates.map((item) => `- \`${item}\``).join("\n")}`;
  }

  if (result.error === "duplicate" && result.candidates && result.candidates.length > 0) {
    return `${result.message}\n${result.candidates.map((item) => `- \`${item}\``).join("\n")}`;
  }

  return result.message;
}
