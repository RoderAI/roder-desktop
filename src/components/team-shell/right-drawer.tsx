import { Activity, Circle, Hash, MessageSquare, Send, Square, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DebugEvent } from "@/lib/debug-events";
import { DEFAULT_TEAM_APP_SHORTCUTS } from "@/lib/team-view-model";
import type { TeamAppId, TeamChannel } from "@/lib/team-view-model";
import type { TeamDrawer, TeamMember } from "./types";
import { MemberAvatar } from "./member-avatar";

type RightDrawerProps = {
  drawer: TeamDrawer;
  channel: TeamChannel;
  members: TeamMember[];
  schedulerRunning: boolean;
  debugEvents: DebugEvent[];
  onOpenAppDrawer: (appId?: TeamAppId) => void;
  onOpenDrawer?: (drawer: TeamDrawer) => void;
  onSendMemberDM: (memberId: string, body: string) => void | Promise<void>;
  onClearDebugEvents: () => void;
  onStopMember: (memberId: string) => void;
};

export function RightDrawer({
  drawer,
  channel,
  members,
  schedulerRunning,
  debugEvents,
  onOpenAppDrawer,
  onOpenDrawer,
  onSendMemberDM,
  onClearDebugEvents,
  onStopMember,
}: RightDrawerProps): React.JSX.Element | null {
  if (!drawer) {
    return null;
  }

  return (
    <aside className="flex h-full w-[342px] shrink-0 flex-col border-l border-border bg-card">
      <div className="drag-region flex h-[56px] items-center border-b border-border px-4">
        <div className="text-sm font-semibold">{drawerTitle(drawer)}</div>
        <Button variant="ghost" size="icon" className="no-drag ml-auto size-8" aria-label="Close drawer" onClick={() => onOpenDrawer?.(null)}>
          <X className="size-4" />
        </Button>
      </div>
      {drawer.type === "details" && <ChannelDetails channel={channel} members={members} schedulerRunning={schedulerRunning} />}
      {drawer.type === "members" && <MemberList members={members} onSendMemberDM={onSendMemberDM} onStopMember={onStopMember} />}
      {drawer.type === "apps" && <AppsPanel activeAppId={drawer.appId} onOpenAppDrawer={onOpenAppDrawer} />}
      {drawer.type === "events" && <EventsPanel events={debugEvents} onClear={onClearDebugEvents} />}
    </aside>
  );
}

function ChannelDetails({
  channel,
  members,
  schedulerRunning,
}: {
  channel: TeamChannel;
  members: TeamMember[];
  schedulerRunning: boolean;
}): React.JSX.Element {
  return (
    <div className="team-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <Hash className="size-5 text-muted-foreground" />
        {channel.name}
      </div>
      <p className="mt-2 text-sm leading-5 text-muted-foreground">{channel.topic ?? channel.description ?? "Open topic space for the team."}</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Stat label="Members" value={members.length.toString()} />
        <Stat label="Scheduler" value={schedulerRunning ? "Running" : "Paused"} />
      </div>
      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase text-muted-foreground">Pinned context</h2>
        <div className="mt-2 rounded-md border border-border bg-background p-3 text-sm leading-5">
          Decisions, links, and active work for this topic can live here once the store supplies pinned items.
        </div>
      </section>
    </div>
  );
}

function MemberList({
  members,
  onSendMemberDM,
  onStopMember,
}: {
  members: TeamMember[];
  onSendMemberDM: (memberId: string, body: string) => void | Promise<void>;
  onStopMember: (memberId: string) => void;
}): React.JSX.Element {
  const [selectedMemberId, setSelectedMemberId] = useState(members[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? members[0];

  async function submitDM(): Promise<void> {
    const body = draft.trim();
    if (!body || !selectedMember) {
      return;
    }
    setDraft("");
    await onSendMemberDM(selectedMember.id, body);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="team-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        {members.map((member) => (
          <div key={member.id} className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent">
            <button type="button" onClick={() => setSelectedMemberId(member.id)}>
              <MemberAvatar member={member} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{member.name}</div>
              <div className="truncate text-xs text-muted-foreground">{member.activeTask ?? member.status ?? member.title ?? "Available"}</div>
            </div>
            <Button variant="ghost" size="icon" className="size-8 opacity-0 group-hover:opacity-100" aria-label={`Message ${member.name}`} onClick={() => setSelectedMemberId(member.id)}>
              <MessageSquare className="size-3.5" />
            </Button>
            <Button variant="ghost" size="compact" className="opacity-0 group-hover:opacity-100" onClick={() => onStopMember(member.id)}>
              <Square className="size-3.5" />
              Stop
            </Button>
          </div>
        ))}
      </div>
      {selectedMember && (
        <div className="border-t border-border p-3">
          <div className="mb-2 text-xs text-muted-foreground">Message {selectedMember.name}</div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
            <input
              value={draft}
              placeholder="Send a quick DM"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitDM();
                }
              }}
            />
            <Button variant="default" size="icon" className="size-7" disabled={!draft.trim()} onClick={() => void submitDM()}>
              <Send className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AppsPanel({
  activeAppId,
  onOpenAppDrawer,
}: {
  activeAppId?: TeamAppId;
  onOpenAppDrawer: (appId?: TeamAppId) => void;
}): React.JSX.Element {
  return (
    <div className="p-4">
      <div className="grid gap-2">
        {DEFAULT_TEAM_APP_SHORTCUTS.map((app) => (
          <button
            key={app.id}
            type="button"
            className="rounded-md border border-border bg-background p-3 text-left hover:bg-accent"
            onClick={() => onOpenAppDrawer(app.id)}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{app.label}</span>
              {activeAppId === app.id && <Badge variant="muted">open</Badge>}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{app.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function EventsPanel({ events, onClear }: { events: DebugEvent[]; onClear: () => void }): React.JSX.Element {
  return (
    <div className="team-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="size-4 text-muted-foreground" />
        <div className="text-sm font-semibold">Raw events</div>
        <Badge variant="muted" className="ml-auto text-[11px]">
          {events.length}
        </Badge>
      </div>
      <Button variant="subtle" size="compact" className="mb-3 h-8 w-full" onClick={onClear}>
        Clear events
      </Button>
      {events.length === 0 ? (
        <div className="rounded-md border border-border bg-background p-3 text-sm leading-5 text-muted-foreground">
          Type in the composer or send a message to see UI, IPC, and notification events here.
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <article key={event.id} className="rounded-md border border-border bg-background p-3">
              <div className="flex items-start gap-2">
                <span className={eventLevelClass(event.level)}>{event.level}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">
                    {event.source}/{event.event}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{formatDebugTime(event.createdAt)}</div>
                </div>
              </div>
              {event.summary && <div className="mt-2 text-xs text-muted-foreground">{event.summary}</div>}
              {event.payload !== undefined && (
                <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-2 font-mono text-[11px] leading-4 text-muted-foreground">
                  {formatPayload(event.payload)}
                </pre>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-sm font-semibold">
        <Circle className="size-2 fill-emerald-500 text-emerald-500" />
        {value}
      </div>
    </div>
  );
}

function drawerTitle(drawer: Exclude<TeamDrawer, null>): string {
  if (drawer.type === "details") {
    return "Channel details";
  }
  if (drawer.type === "members") {
    return "Members";
  }
  if (drawer.type === "events") {
    return "Raw events";
  }
  return "Apps";
}

function eventLevelClass(level: DebugEvent["level"]): string {
  const base = "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase";
  if (level === "error") {
    return `${base} bg-destructive/10 text-destructive`;
  }
  if (level === "warn") {
    return `${base} bg-amber-500/12 text-amber-700`;
  }
  return `${base} bg-emerald-500/10 text-emerald-700`;
}

function formatDebugTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatPayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  return JSON.stringify(payload, null, 2);
}
