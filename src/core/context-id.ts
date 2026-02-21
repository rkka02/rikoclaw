import type { ChatInputCommandInteraction, Message } from "discord.js";

export function resolveContextIdFromInteraction(
  interaction: ChatInputCommandInteraction,
): string {
  return resolveContextId(interaction.channel, interaction.user.id);
}

export function resolveContextIdFromMessage(message: Message): string {
  return resolveContextId(message.channel, message.author.id);
}

export function resolveContextId(
  channel: Message["channel"] | ChatInputCommandInteraction["channel"],
  userId: string,
): string {
  if (!channel) {
    return `dm_${userId}`;
  }

  const channelLike = channel as {
    id: string;
    isDMBased?: () => boolean;
    isThread?: () => boolean;
  };

  if (typeof channelLike.isDMBased === "function" && channelLike.isDMBased()) {
    return `dm_${userId}`;
  }
  if (typeof channelLike.isThread === "function" && channelLike.isThread()) {
    return `th_${channelLike.id}`;
  }
  return `ch_${channelLike.id}`;
}
