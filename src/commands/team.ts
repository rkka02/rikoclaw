import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { BotContext } from "../bot.js";

export const data = new SlashCommandBuilder()
  .setName("team")
  .setDescription("멀티스텝 파이프라인을 실행합니다")
  .addStringOption((opt) =>
    opt
      .setName("instruction")
      .setDescription("자연어로 작업 지시 (모델, 모드, 작업 포함)")
      .setRequired(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<void> {
  if (interaction.user.id !== ctx.config.ownerId) {
    await interaction.reply({
      content: "소유자만 사용할 수 있는 명령어입니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const instruction = interaction.options.getString("instruction", true);
  const channel = interaction.channel;
  if (!channel) {
    await interaction.editReply("채널 정보를 가져올 수 없습니다.");
    return;
  }

  try {
    await ctx.team.startPlanning(channel, interaction.user.id, instruction, ctx);
    await interaction.editReply("파이프라인 플랜을 생성했습니다. 위 임베드를 확인하고 승인해주세요.");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await interaction.editReply(`파이프라인 생성 실패: ${message}`);
  }
}
