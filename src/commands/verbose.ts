import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { BotContext } from "../bot.js";
import { resolveContextIdFromInteraction } from "../core/context-id.js";
import { checkAccess } from "../utils/access-control.js";

const VERBOSE_CHOICES = [
  { name: "on", value: "on" },
  { name: "off", value: "off" },
  { name: "default", value: "default" },
] as const;

export const data = new SlashCommandBuilder()
  .setName("verbose")
  .setDescription("진행 상황(라이브 업데이트) 표시를 켜거나 끕니다")
  .addStringOption((option) =>
    option
      .setName("set")
      .setDescription("설정값 (미지정 시 현재 상태 표시)")
      .setRequired(false)
      .addChoices(...VERBOSE_CHOICES),
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

  const contextId = resolveContextIdFromInteraction(interaction);
  const userId = interaction.user.id;
  const taskKey = `${userId}:${contextId}`;

  const selection = interaction.options.getString("set")?.trim().toLowerCase() || "";
  if (!selection) {
    const override = ctx.verbose.getOverride(userId, contextId);
    const effective = ctx.verbose.isEnabled(userId, contextId);
    const defaultValue = ctx.config.enableLiveUpdates;

    const effectiveText = effective ? "on" : "off";
    const overrideText = override === null ? "default" : override ? "on" : "off";
    const defaultText = defaultValue ? "on" : "off";

    await interaction.reply({
      content:
        `현재 verbose: \`${effectiveText}\` (override: \`${overrideText}\`, default: \`${defaultText}\`)\n` +
        "이 채널(대화 맥락)에서만 적용됩니다.\n" +
        "변경: `/verbose set:on` | `/verbose set:off` | `/verbose set:default`",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (selection === "on") {
    ctx.verbose.setOverride(userId, contextId, true);
  } else if (selection === "off") {
    ctx.verbose.setOverride(userId, contextId, false);
  } else if (selection === "default") {
    ctx.verbose.setOverride(userId, contextId, null);
  } else {
    await interaction.reply({
      content: "잘못된 값입니다. `/verbose set:on|off|default` 중에서 선택하세요.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const effective = ctx.verbose.isEnabled(userId, contextId);
  const effectiveText = effective ? "on" : "off";

  let runtimeNote = "";
  if (effective) {
    const applied = await ctx.queue.enableLiveUpdates(taskKey);
    runtimeNote = applied
      ? "현재 실행 중 작업에도 즉시 적용했습니다."
      : "현재 실행 중 작업이 없어서 다음 요청부터 적용됩니다.";
  } else {
    const paused = ctx.queue.disableLiveUpdates(taskKey);
    runtimeNote = paused
      ? "현재 실행 중 작업의 라이브 업데이트를 일시정지했습니다."
      : "현재 실행 중 작업이 없어서 다음 요청부터 적용됩니다.";
  }

  await interaction.reply({
    content:
      `verbose 설정 완료: \`${effectiveText}\` (이 채널에서만 적용)\n${runtimeNote}`,
    flags: MessageFlags.Ephemeral,
  });
}
