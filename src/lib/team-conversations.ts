import type { RoderTeamMessage } from "@/types/team";

const DM_CHANNEL_PREFIX = "dm:";

export function dmChannelId(memberId: string): string {
  return `${DM_CHANNEL_PREFIX}${memberId}`;
}

export function memberIdFromDmChannelId(channelId: string | null | undefined): string | null {
  if (!channelId?.startsWith(DM_CHANNEL_PREFIX)) {
    return null;
  }
  const memberId = channelId.slice(DM_CHANNEL_PREFIX.length);
  return memberId.length > 0 ? memberId : null;
}

export function conversationIdForMessage(
  message: Pick<RoderTeamMessage, "channel_id" | "author_member_id">,
): string {
  return message.channel_id ?? (message.author_member_id ? dmChannelId(message.author_member_id) : "direct");
}
