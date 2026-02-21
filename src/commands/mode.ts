import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { BotContext } from "../bot.js";
import { resolveContextIdFromInteraction } from "../core/context-id.js";
import { MechoClient } from "../integrations/mecho-client.js";
import { checkAccess } from "../utils/access-control.js";

export const data = new SlashCommandBuilder()
  .setName("mode")
  .setDescription("Manage mecho modes")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("list")
      .setDescription("List all created mecho modes"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("create")
      .setDescription("Create mecho storage for a mode")
      .addStringOption((option) =>
        option.setName("mode_id").setDescription("Mode ID (letters, numbers, _, -)").setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set")
      .setDescription("Bind a mecho mode to this chat context")
      .addStringOption((option) =>
        option.setName("mode_id").setDescription("Mode ID (letters, numbers, _, -)").setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("current")
      .setDescription("Show mecho mode binding for this chat context"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("reset")
      .setDescription("Reset mecho mode binding for this chat context"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("delete")
      .setDescription("Delete mecho storage for a mode")
      .addStringOption((option) =>
        option.setName("mode_id").setDescription("Mode ID (letters, numbers, _, -)").setRequired(true),
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand(true);
  const ownerOnly = subcommand === "create" || subcommand === "delete";
  if (ownerOnly && interaction.user.id !== ctx.config.ownerId) {
    await interaction.reply({
      content: "Owner only command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!ownerOnly) {
    const access = checkAccess(ctx.config, interaction.user.id, interaction.channelId);
    if (!access.allowed) {
      await interaction.reply({
        content: access.reason || "No permission.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  const inputModeId = interaction.options.getString("mode_id");
  const mecho = new MechoClient(ctx.config);
  const contextId = resolveContextIdFromInteraction(interaction);
  const userId = interaction.user.id;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (subcommand === "list") {
      if (!ctx.config.mechoEnabled) {
        await interaction.editReply(
          "Mecho is disabled (`MECHO_ENABLED=false`).",
        );
        return;
      }
      const result = await mecho.listModes();
      if (result.modes.length === 0) {
        await interaction.editReply("No mecho modes found.");
        return;
      }
      const current = ctx.mechoModes.getModeId(userId, contextId);
      const effective = mecho.resolveModeId(current || null);
      const lines = result.modes.map((m) =>
        m === effective ? `• **${m}** ← current` : `• ${m}`,
      );
      await interaction.editReply(
        `**Mecho modes** (${result.modes.length})\n${lines.join("\n")}`,
      );
      return;
    }

    if (subcommand === "create") {
      if (!ctx.config.mechoEnabled) {
        await interaction.editReply(
          "Mecho is disabled (`MECHO_ENABLED=false`). Enable it and run `npm --prefix mecho run start`.",
        );
        return;
      }
      if (!inputModeId) {
        await interaction.editReply("`mode_id` is required.");
        return;
      }
      console.log(`[mecho] mode create call input=${inputModeId}`);
      const result = await mecho.createMode(inputModeId);
      console.log(`[mecho] mode create ok mode=${result.modeId} created=${result.created}`);
      await interaction.editReply(
        `Mode \`${result.modeId}\`: ${result.created ? "created" : "already existed"}.`,
      );
      return;
    }

    if (subcommand === "delete") {
      if (!ctx.config.mechoEnabled) {
        await interaction.editReply(
          "Mecho is disabled (`MECHO_ENABLED=false`). Enable it and run `npm --prefix mecho run start`.",
        );
        return;
      }
      if (!inputModeId) {
        await interaction.editReply("`mode_id` is required.");
        return;
      }
      console.log(`[mecho] mode delete call input=${inputModeId}`);
      const result = await mecho.deleteMode(inputModeId);
      console.log(`[mecho] mode delete ok mode=${result.modeId} deleted=${result.deleted}`);
      await interaction.editReply(
        `Mode \`${result.modeId}\`: ${result.deleted ? "deleted" : "not deleted"}.`,
      );
      return;
    }

    if (subcommand === "set") {
      if (!inputModeId) {
        await interaction.editReply("`mode_id` is required.");
        return;
      }
      const normalized = mecho.resolveModeId(inputModeId);
      ctx.mechoModes.setModeId(userId, contextId, normalized);
      console.log(`[mecho] mode bind set user=${userId} context=${contextId} mode=${normalized}`);
      await interaction.editReply(
        `Mecho mode for this context is now \`${normalized}\`.`,
      );
      return;
    }

    if (subcommand === "current") {
      const bound = ctx.mechoModes.getModeId(userId, contextId);
      const effective = mecho.resolveModeId(bound || null);
      const source = bound ? "context binding" : "default";
      await interaction.editReply(
        `Current mecho mode: \`${effective}\` (${source}).`,
      );
      return;
    }

    if (subcommand === "reset") {
      ctx.mechoModes.setModeId(userId, contextId, null);
      const fallback = mecho.resolveModeId(null);
      console.log(`[mecho] mode bind reset user=${userId} context=${contextId}`);
      await interaction.editReply(
        `Mecho mode binding cleared. Effective mode is now default \`${fallback}\`.`,
      );
      return;
    }

    await interaction.editReply("Unsupported subcommand.");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`Mode command failed: ${message}`);
  }
}
