import { FileText, MessageSquare, MoreHorizontal, SmilePlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatTeamDay, formatTeamTime } from "@/lib/team-view-model";
import type { TeamMember, TeamMessage } from "./types";
import { MemberAvatar } from "./member-avatar";

type MessageTimelineProps = {
  messages: TeamMessage[];
  membersById: Map<string, TeamMember>;
};

export function MessageTimeline({ messages, membersById }: MessageTimelineProps): React.JSX.Element {
  const ordered = [...messages].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  if (ordered.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        No messages yet. Start the channel thread from the composer.
      </div>
    );
  }

  let lastDay = "";

  return (
    <div className="team-scrollbar min-h-0 flex-1 overflow-y-auto bg-background py-4">
      <div className="mx-auto w-full max-w-[1040px] px-5">
        {ordered.map((message) => {
          const day = formatTeamDay(message.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;

          return (
            <div key={message.id}>
              {showDay && (
                <div className="sticky top-2 z-10 my-4 flex justify-center">
                  <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">{day}</span>
                </div>
              )}
              <MessageRow message={message} member={membersById.get(message.authorId)} membersById={membersById} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MessageRow({
  message,
  member,
  membersById,
}: {
  message: TeamMessage;
  member?: TeamMember;
  membersById: Map<string, TeamMember>;
}): React.JSX.Element {
  const fallbackMember: TeamMember = {
    id: message.authorId,
    name: "Unknown teammate",
    initials: "?",
    presence: "offline",
  };
  const author = member ?? fallbackMember;

  return (
    <article className="group grid grid-cols-[40px_1fr] gap-3 rounded-md px-2 py-1.5 hover:bg-accent/45">
      <MemberAvatar member={author} size="lg" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[14px] font-semibold">{author.name}</span>
          <span className="text-xs text-muted-foreground">{formatTeamTime(message.createdAt)}</span>
          {message.edited && <span className="text-xs text-muted-foreground">(edited)</span>}
          <button className="ml-auto opacity-0 transition-opacity group-hover:opacity-100" aria-label="Message actions">
            <MoreHorizontal className="size-4 text-muted-foreground" />
          </button>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-5 text-foreground">{renderMessageBody(message.body, membersById)}</p>
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 grid gap-2">
            {message.attachments.map((attachment) => (
              <div key={attachment.id} className="flex max-w-[520px] items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                {attachment.meta && <span className="text-xs text-muted-foreground">{attachment.meta}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {message.reactions?.map((reaction) => (
            <button
              key={reaction.emoji}
              type="button"
              className={cn(
                "flex h-6 items-center gap-1 rounded-full border border-border bg-card px-2 text-xs hover:bg-accent",
                reaction.reacted && "border-ring bg-secondary text-secondary-foreground",
              )}
            >
              <span>{reaction.emoji}</span>
              <span>{reaction.count}</span>
            </button>
          ))}
          <button className="flex size-6 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100" aria-label="Add reaction">
            <SmilePlus className="size-3.5" />
          </button>
          {message.threadCount ? (
            <Badge variant="outline" className="h-6 gap-1 rounded-full text-xs">
              <MessageSquare className="size-3" />
              {message.threadCount} {message.threadCount === 1 ? "reply" : "replies"}
            </Badge>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function renderMessageBody(body: string, membersById: Map<string, TeamMember>): React.ReactNode {
  const members = [...membersById.values()].filter((member) => member.id !== "system");
  if (members.length === 0 || !body.includes("@")) {
    return body;
  }

  const names = members
    .map((member) => member.name)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  if (names.length === 0) {
    return body;
  }

  const pattern = new RegExp(`@(${names.map(escapeRegExp).join("|")})(?=\\b|\\s|$)`, "g");
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push(body.slice(lastIndex, index));
    }
    parts.push(
      <span key={`${index}-${match[0]}`} className="rounded bg-secondary px-1 font-medium text-secondary-foreground">
        {match[0]}
      </span>,
    );
    lastIndex = index + match[0].length;
  }
  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex));
  }
  return parts.length > 0 ? parts : body;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
