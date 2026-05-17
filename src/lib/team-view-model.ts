import type { TeamMember, TeamMessage, TeamShellTeam } from "@/components/team-shell/types";
import { conversationIdForMessage } from "@/lib/team-conversations";
import type { RoderTeam, RoderTeamChannel, RoderTeamMember, RoderTeamMessage } from "@/types/team";

export type TeamChannel = {
  id: string;
  name: string;
  description?: string;
  unreadCount?: number;
  mentionCount?: number;
  memberIds?: string[];
  topic?: string;
};

export type TeamAppId = "terminal" | "browser" | "canvas" | "events" | "settings";

export type TeamAppShortcut = {
  id: TeamAppId;
  label: string;
  description: string;
  hotkey?: string;
};

export const DEFAULT_TEAM_CHANNELS: TeamChannel[] = [
  { id: "general", name: "general", topic: "Shared updates and coordination" },
  { id: "standup", name: "standup", topic: "Daily progress and blockers" },
  { id: "reviews", name: "reviews", topic: "Code reviews and decisions" },
  { id: "debugging", name: "debugging", topic: "Incidents, repros, logs" },
  { id: "architecture", name: "architecture", topic: "Design tradeoffs and plans" },
  { id: "shipping", name: "shipping", topic: "Release readiness and deploys" },
  { id: "research", name: "research", topic: "Findings and references" },
  { id: "ideas", name: "ideas", topic: "Loose product thinking" },
  { id: "random", name: "random", topic: "Off-topic chatter" },
];

export const DEFAULT_TEAM_APP_SHORTCUTS: TeamAppShortcut[] = [
  { id: "terminal", label: "Terminal", description: "Run local commands", hotkey: "⌘`" },
  { id: "browser", label: "Browser", description: "Inspect web surfaces", hotkey: "⌘B" },
  { id: "canvas", label: "Canvas", description: "Open visual artifacts", hotkey: "⌘K" },
  { id: "events", label: "Events", description: "Inspect raw UI and Roder events", hotkey: "⌘E" },
  { id: "settings", label: "Settings", description: "Models and preferences", hotkey: "⌘," },
];

export const LOCAL_MEMBER_ID = "self";
export const SYSTEM_MEMBER_ID = "system";

export function channelTitle(channelId: string, channels: TeamChannel[] = DEFAULT_TEAM_CHANNELS): string {
  return channels.find((channel) => channel.id === channelId)?.name ?? channelId;
}

export function toTeamShellTeam(team: RoderTeam | null | undefined): TeamShellTeam {
  if (!team) {
    return {
      id: "loading",
      name: "Roder Team",
      subtitle: "Starting Slack-style agent workspace",
      channels: DEFAULT_TEAM_CHANNELS,
      appShortcuts: DEFAULT_TEAM_APP_SHORTCUTS,
    };
  }

  return {
    id: team.id,
    name: team.name || "Roder Team",
    subtitle: team.workspace ?? `${team.provider}/${team.model}`,
    channels: team.channels.map(toShellChannel),
    appShortcuts: DEFAULT_TEAM_APP_SHORTCUTS,
  };
}

export function toTeamShellMembers(team: RoderTeam | null | undefined): TeamMember[] {
  const members = team?.members ?? [];
  return [
    {
      id: LOCAL_MEMBER_ID,
      name: "You",
      title: "Local teammate",
      presence: "active",
      status: "here",
      initials: "YZ",
      color: "#1264a3",
    },
    {
      id: SYSTEM_MEMBER_ID,
      name: "Roder",
      title: "Workspace",
      presence: "active",
      status: team?.scheduler_running ? "scheduler running" : "scheduler paused",
      initials: "R",
      color: "var(--primary)",
    },
    ...members.map(toShellMember),
  ];
}

export function toTeamShellMessages(messages: RoderTeamMessage[]): TeamMessage[] {
  return messages.map((message) => ({
    id: message.id,
    channelId: conversationIdForMessage(message),
    authorId: authorIdForMessage(message),
    body: message.text,
    createdAt: message.created_at,
    threadCount: message.thread_ts ? 1 : undefined,
    threadPreview: message.thread_ts ?? undefined,
    attachments: message.turn_id
      ? [
          {
            id: `${message.id}-turn`,
            name: message.turn_id,
            kind: "log",
            meta: "turn",
          },
        ]
      : undefined,
  }));
}

function authorIdForMessage(message: RoderTeamMessage): string {
  if (message.author_kind === "user") {
    return LOCAL_MEMBER_ID;
  }
  if (message.author_kind === "system") {
    return SYSTEM_MEMBER_ID;
  }
  return message.author_member_id ?? SYSTEM_MEMBER_ID;
}

export function memberInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

export function formatTeamTime(value: string | number | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatTeamDay(value: string | number | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function toShellChannel(channel: RoderTeamChannel): TeamChannel {
  const defaults = DEFAULT_TEAM_CHANNELS.find((item) => item.id === channel.id);
  return {
    ...defaults,
    id: channel.id,
    name: channel.name,
    description: channel.description ?? defaults?.description,
    topic: channel.topic ?? defaults?.topic,
  };
}

function toShellMember(member: RoderTeamMember): TeamMember {
  const name = member.name ?? member.display_name ?? titleize(member.role || member.id);
  return {
    id: member.id,
    name,
    title: titleize(member.role),
    presence: presenceForStatus(member.status),
    status: member.status,
    activeTask: member.worktree_path ? shortWorktree(member.worktree_path) : `${member.provider}/${member.model}`,
    initials: memberInitials(name),
    color: memberColor(member.id),
  };
}

function presenceForStatus(status: string | undefined): TeamMember["presence"] {
  if (status === "offline") {
    return "offline";
  }
  if (status === "blocked" || status === "error") {
    return "busy";
  }
  if (status === "working") {
    return "active";
  }
  return "away";
}

function titleize(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function shortWorktree(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join("/") : path;
}

function memberColor(id: string): string {
  const colors = ["#1264a3", "#2eb67d", "#e01e5a", "#ecb22e", "#611f69", "#36c5f0", "#4a154b", "#007a5a"];
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return colors[hash % colors.length];
}
