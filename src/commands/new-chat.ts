import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { BotContext } from "../bot.js";
import { resolveContextIdFromInteraction } from "../core/context-id.js";
import { checkAccess } from "../utils/access-control.js";
import { formatQueueStatus } from "../utils/formatter.js";

export const data = new SlashCommandBuilder()
  .setName("new")
  .setDescription("새 대화를 시작합니다")
  .addStringOption((option) =>
    option.setName("prompt").setDescription("질문 내용").setRequired(false),
  )
  .addAttachmentOption((option) =>
    option
      .setName("file")
      .setDescription("분석할 파일 (선택)")
      .setRequired(false),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<void> {
  const { config, queue, sessions } = ctx;

  const access = checkAccess(config, interaction.user.id, interaction.channelId);
  if (!access.allowed) {
    await interaction.reply({ content: access.reason!, flags: MessageFlags.Ephemeral });
    return;
  }

  const prompt = interaction.options.getString("prompt")?.trim() || "";
  const file = interaction.options.getAttachment("file");
  if (!prompt && !file) {
    await interaction.reply({
      content: "질문 내용 또는 파일을 하나 이상 넣어주세요.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  const contextId = resolveContextIdFromInteraction(interaction);
  const userId = interaction.user.id;
  const taskKey = `${userId}:${contextId}`;
  const engine = ctx.engines.getEngine(userId, contextId);
  const effectiveEngine = ctx.runners.has(engine) ? engine : "claude";
  const model = ctx.models.getModel(userId, contextId, effectiveEngine);
  const previousSessionId = sessions.getSession(userId, contextId, effectiveEngine);
  sessions.deleteSession(userId, contextId);
  const attachments = file
    ? [
        {
          url: file.url,
          name: file.name,
          size: file.size,
          contentType: file.contentType ?? null,
        },
      ]
    : undefined;
  const effectivePrompt = prompt || "첨부된 파일을 확인해줘.";

  const enqueueResult = queue.enqueue({
    prompt: effectivePrompt,
    sessionId: null,
    model,
    taskKey,
    respondTo: { type: "interaction", interaction },
    createdAt: Date.now(),
    engine: effectiveEngine,
    attachments,
    rotateFromSessionId: previousSessionId,
  });

  if (!enqueueResult.accepted) {
    if (enqueueResult.reason === "duplicate") {
      await interaction.followUp({
        content: "이 대화는 이미 처리 중입니다. 이전 응답이 끝난 뒤 다시 보내주세요.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.followUp({
      content: `대기열이 가득 찼습니다 (${config.maxQueueSize}개). 잠시 후 다시 시도해주세요.`,
    });
    return;
  }

  if (enqueueResult.position > 1) {
    await interaction.followUp({
      content: formatQueueStatus(enqueueResult.position),
      flags: MessageFlags.Ephemeral,
    });
  }
}
