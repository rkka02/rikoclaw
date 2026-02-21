import type { Config } from "./config.js";

export interface AccessResult {
  allowed: boolean;
  reason?: string;
}

export function checkAccess(
  config: Config,
  userId: string,
  channelId: string | null,
): AccessResult {
  if (userId === config.ownerId) {
    return { allowed: true };
  }

  if (config.allowedUserIds.size > 0 && !config.allowedUserIds.has(userId)) {
    return { allowed: false, reason: "허용되지 않은 사용자입니다." };
  }

  if (
    channelId &&
    config.allowedChannelIds.size > 0 &&
    !config.allowedChannelIds.has(channelId)
  ) {
    return { allowed: false, reason: "이 채널에서는 사용할 수 없습니다." };
  }

  return { allowed: true };
}
