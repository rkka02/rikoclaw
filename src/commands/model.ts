import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { BotContext } from "../bot.js";
import { resolveContextIdFromInteraction } from "../core/context-id.js";
import { checkAccess } from "../utils/access-control.js";

const MODEL_DEFAULT = "__default__";

const CLAUDE_MODEL_CHOICES = [
  { name: "Claude: claude-opus-4-6", value: "claude-opus-4-6" },
  { name: "Claude: claude-sonnet-4-6", value: "claude-sonnet-4-6" },
  { name: "Claude: claude-sonnet-4-5", value: "claude-sonnet-4-5" },
  { name: "Claude: claude-opus-4-1", value: "claude-opus-4-1" },
  { name: "Claude: claude-haiku-4-5", value: "claude-haiku-4-5" },
] as const;

// NOTE: Codex CLI model names available in this environment.
const CODEX_MODEL_CHOICES = [
  { name: "Codex: gpt-5.3-codex", value: "gpt-5.3-codex" },
  { name: "Codex: gpt-5.2", value: "gpt-5.2" },
] as const;

const MODEL_CHOICES = [
  { name: "기본값(현재 엔진)", value: MODEL_DEFAULT },
  ...CLAUDE_MODEL_CHOICES,
  ...CODEX_MODEL_CHOICES,
] as const;

const CLAUDE_MODEL_VALUES = new Set<string>(CLAUDE_MODEL_CHOICES.map((item) => item.value));
const CODEX_MODEL_VALUES = new Set<string>(CODEX_MODEL_CHOICES.map((item) => item.value));

export const data = new SlashCommandBuilder()
  .setName("model")
  .setDescription("현재 대화 맥락에서 사용할 모델을 설정합니다")
  .addStringOption((option) =>
    option
      .setName("preset")
      .setDescription("프리셋 모델 선택")
      .setRequired(false)
      .addChoices(...MODEL_CHOICES),
  )
  .addStringOption((option) =>
    option
      .setName("custom")
      .setDescription("직접 입력 모델명 (preset보다 우선)")
      .setRequired(false),
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
  const engine = ctx.engines.getEngine(userId, contextId);
  const engineLabel = engine === "codex" ? "Codex" : "Claude";

  const preset = interaction.options.getString("preset");
  const customRaw = interaction.options.getString("custom");
  const custom = customRaw?.trim() || "";

  if (!preset && !custom) {
    const userOverride = ctx.models.getModel(userId, contextId, engine);
    const envDefault =
      engine === "codex" ? ctx.config.codexModel || "" : ctx.config.claudeModel || "";
    // What actually gets passed as --model to the CLI
    const cliModel = userOverride || envDefault || null;
    const cliModelDisplay = cliModel || "(플래그 없음 → CLI 내부 기본값)";

    const lines: string[] = [
      `**엔진:** ${engineLabel}`,
      `**CLI에 넘어가는 모델:** \`${cliModelDisplay}\``,
    ];
    if (userOverride) {
      lines.push(`  ↳ 출처: 사용자 오버라이드 (\`/model\`로 설정)`);
    } else if (envDefault) {
      lines.push(`  ↳ 출처: 환경변수 \`${engine === "codex" ? "CODEX_MODEL" : "CLAUDE_MODEL"}\``);
    } else {
      lines.push(`  ↳ 출처: \`--model\` 플래그 미전달 (CLI 자체 기본값 사용)`);
    }
    if (userOverride && envDefault) {
      lines.push(`  ↳ env 기본값: \`${envDefault}\` (오버라이드에 의해 무시됨)`);
    }
    lines.push("", "변경: `/model preset:...` 또는 `/model custom:...`");
    await interaction.reply({
      content: lines.join("\n"),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (custom) {
    ctx.models.setModel(userId, contextId, engine, custom);
    console.log(`[model] set user=${userId} engine=${engine} model=${custom}`);
    await interaction.reply({
      content: `기본 모델(${engineLabel})을 \`${custom}\`로 설정했습니다. (이 대화에만 적용)`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (preset === MODEL_DEFAULT) {
    ctx.models.setModel(userId, contextId, engine, null);
    const fallback =
      engine === "codex"
        ? ctx.config.codexModel || "(CLI 기본값)"
        : ctx.config.claudeModel || "(CLI 기본값)";
    console.log(`[model] reset user=${userId} engine=${engine} fallback=${fallback}`);
    await interaction.reply({
      content: `모델(${engineLabel}) 설정을 기본값으로 되돌렸습니다. 현재 기본: \`${fallback}\``,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (preset) {
    const isClaudePreset = CLAUDE_MODEL_VALUES.has(preset);
    const isCodexPreset = CODEX_MODEL_VALUES.has(preset);
    if (engine === "claude" && isCodexPreset) {
      await interaction.reply({
        content:
          "이 프리셋은 Codex 전용입니다.\n" +
          "`/engine engine:codex`로 바꾸거나 `/model custom:...`을 사용하세요.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (engine === "codex" && isClaudePreset) {
      await interaction.reply({
        content:
          "이 프리셋은 Claude 전용입니다.\n" +
          "`/engine engine:claude`로 바꾸거나 `/model custom:...`을 사용하세요.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!isClaudePreset && !isCodexPreset) {
      await interaction.reply({
        content: "알 수 없는 preset 값입니다. `/model custom:...`로 다시 설정해주세요.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    ctx.models.setModel(userId, contextId, engine, preset);
    console.log(`[model] set user=${userId} engine=${engine} model=${preset}`);
    await interaction.reply({
      content: `기본 모델(${engineLabel})을 \`${preset}\`로 설정했습니다. (이 대화에만 적용)`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}
