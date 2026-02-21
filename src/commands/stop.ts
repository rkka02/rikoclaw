import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { BotContext } from "../bot.js";
import { resolveContextIdFromInteraction } from "../core/context-id.js";
import { checkAccess } from "../utils/access-control.js";

export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("현재 실행 중이거나 대기 중인 요청을 중단합니다");

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<void> {
  const access = checkAccess(ctx.config, interaction.user.id, interaction.channelId);
  if (!access.allowed) {
    await interaction.reply({ content: access.reason!, flags: MessageFlags.Ephemeral });
    return;
  }

  const lines: string[] = [];

  // 1) 일반 작업 취소
  const contextId = resolveContextIdFromInteraction(interaction);
  const taskKey = `${interaction.user.id}:${contextId}`;
  const result = ctx.queue.cancel(taskKey);

  if (result.cancelledRunning) {
    lines.push("실행 중인 요청에 중단을 요청했습니다.");
  }
  if (result.removedPending > 0) {
    lines.push(`대기 중인 요청 ${result.removedPending}개를 취소했습니다.`);
  }

  // 2) 팀 파이프라인 취소
  const teamRun = ctx.team.getActiveRun(interaction.channelId, interaction.user.id);
  if (teamRun) {
    ctx.team.cancelRun(teamRun.id);
    const stepInfo = teamRun.steps[teamRun.currentStep];
    const progress = stepInfo
      ? `Step ${stepInfo.index + 1}/${teamRun.steps.length}`
      : "";
    lines.push(`Team 파이프라인을 중단했습니다. ${progress ? `(${progress}에서 중단)` : ""}`);
  }

  if (lines.length === 0) {
    await interaction.reply({
      content: "중단할 실행 중 요청이 없습니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: lines.join("\n"),
    flags: MessageFlags.Ephemeral,
  });
}
