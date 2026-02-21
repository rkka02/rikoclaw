import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { BotContext } from "../bot.js";
import { resolveContextIdFromInteraction } from "../core/context-id.js";
import type { EngineType } from "../core/llm-runner.js";
import { checkAccess } from "../utils/access-control.js";

const ENGINE_CHOICES = [
  { name: "claude", value: "claude" },
  { name: "codex", value: "codex" },
] as const;

export const data = new SlashCommandBuilder()
  .setName("engine")
  .setDescription("LLM 엔진을 선택합니다 (Claude / Codex)")
  .addStringOption((option) =>
    option
      .setName("engine")
      .setDescription("사용할 엔진")
      .setRequired(false)
      .addChoices(...ENGINE_CHOICES),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<void> {
  const access = checkAccess(ctx.config, interaction.user.id, interaction.channelId);
  if (!access.allowed) {
    await interaction.reply({
      content: access.reason || "권한이 없습니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const userId = interaction.user.id;
  const contextId = resolveContextIdFromInteraction(interaction);
  const selected = interaction.options.getString("engine") as EngineType | null;

  if (!selected) {
    const current = ctx.engines.getEngine(userId, contextId);
    await interaction.reply({
      content:
        `현재 엔진(이 대화): \`${current}\`\n` +
        "변경하려면 `/engine engine:claude` 또는 `/engine engine:codex`를 사용하세요.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!ctx.runners.has(selected)) {
    await interaction.reply({
      content: `\`${selected}\` 엔진이 비활성화 상태입니다. 봇 오너에게 활성화를 요청해주세요.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  ctx.engines.setEngine(userId, contextId, selected);
  console.log(`[engine] set user=${userId} context=${contextId} engine=${selected}`);
  await interaction.reply({
    content: `엔진(이 대화)을 \`${selected}\`(으)로 설정했습니다.`,
    flags: MessageFlags.Ephemeral,
  });
}
