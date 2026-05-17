import type { TeamAppId, TeamAppShortcut, TeamChannel } from "@/lib/team-view-model";

export type TeamMemberPresence = "active" | "away" | "busy" | "offline";

export type TeamMember = {
  id: string;
  name: string;
  title?: string;
  avatarUrl?: string;
  initials?: string;
  presence?: TeamMemberPresence;
  status?: string;
  activeTask?: string;
  unreadCount?: number;
  color?: string;
};

export type TeamReaction = {
  emoji: string;
  count: number;
  reacted?: boolean;
};

export type TeamMessageAttachment = {
  id: string;
  name: string;
  kind?: "file" | "image" | "link" | "diff" | "log";
  meta?: string;
};

export type TeamMessage = {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  createdAt: string | number | Date;
  edited?: boolean;
  reactions?: TeamReaction[];
  threadCount?: number;
  threadPreview?: string;
  attachments?: TeamMessageAttachment[];
};

export type TeamDrawer =
  | { type: "details" }
  | { type: "apps"; appId?: TeamAppId }
  | { type: "members" }
  | null;

export type TeamShellTeam = {
  id: string;
  name: string;
  subtitle?: string;
  channels?: TeamChannel[];
  appShortcuts?: TeamAppShortcut[];
};

export type TeamShellProps = {
  team: TeamShellTeam;
  activeChannelId: string;
  messages: TeamMessage[];
  members: TeamMember[];
  activeDrawer: TeamDrawer;
  schedulerRunning: boolean;
  onSelectChannel: (channelId: string) => void;
  onSendChannelMessage: (channelId: string, body: string) => void | Promise<void>;
  onSendMemberDM: (memberId: string, body: string) => void | Promise<void>;
  onToggleScheduler: () => void;
  onOpenAppDrawer: (appId?: TeamAppId) => void;
  onOpenDrawer?: (drawer: TeamDrawer) => void;
  onStopMember: (memberId: string) => void;
};
