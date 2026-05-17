import { AtSign, Plus, Send, Smile, Zap } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { recordDebugEvent } from "@/stores/debug-event-store";
import { MemberAvatar } from "./member-avatar";
import type { TeamMember } from "./types";

type TeamComposerProps = {
  channelId: string;
  channelName: string;
  placeholder?: string;
  members: TeamMember[];
  onSendChannelMessage: (channelId: string, body: string) => void | Promise<void>;
};

type MentionState = {
  start: number;
  end: number;
  query: string;
};

export function TeamComposer({
  channelId,
  channelName,
  placeholder,
  members,
  onSendChannelMessage,
}: TeamComposerProps): React.JSX.Element {
  const [body, setBody] = useState("");
  const [mention, setMention] = useState<MentionState | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionableMembers = useMemo(() => members.filter((member) => member.id !== "system"), [members]);
  const mentionMatches = useMemo(() => {
    const query = mention?.query.trim().toLowerCase() ?? "";
    const matches = query
      ? mentionableMembers.filter((member) => `${member.name} ${member.title ?? ""}`.toLowerCase().includes(query))
      : mentionableMembers;
    return matches.slice(0, 7);
  }, [mention?.query, mentionableMembers]);

  async function submit(): Promise<void> {
    const value = body.trim();
    if (!value) {
      recordComposerEvent("submit:empty", { channelId });
      return;
    }
    recordComposerEvent("submit:start", { channelId, text: value });
    setBody("");
    setMention(null);
    try {
      await onSendChannelMessage(channelId, value);
      recordComposerEvent("submit:ok", { channelId, text: value });
    } catch (error) {
      recordComposerEvent("submit:error", { channelId, error: (error as Error).message, text: value }, "error");
      throw error;
    }
  }

  function updateMentionState(value: string, cursor: number): void {
    const nextMention = mentionAtCursor(value, cursor);
    setMention(nextMention);
    setActiveMentionIndex(0);
  }

  function insertMention(member: TeamMember): void {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? body.length;
    const activeMention = mention ?? { start: cursor, end: cursor, query: "" };
    const prefix = body.slice(0, activeMention.start);
    const suffix = body.slice(activeMention.end);
    const nextBody = `${prefix}@${member.name} ${suffix}`;
    const nextCursor = prefix.length + member.name.length + 2;

    setBody(nextBody);
    setMention(null);
    recordComposerEvent("mention:insert", { channelId, memberId: member.id, memberName: member.name, value: nextBody });
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function openMentionPicker(): void {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? body.length;
    const prefix = body.slice(0, cursor);
    const suffix = body.slice(cursor);
    const separator = prefix.length === 0 || /\s$/.test(prefix) ? "" : " ";
    const nextBody = `${prefix}${separator}@${suffix}`;
    const atIndex = prefix.length + separator.length;

    setBody(nextBody);
    setMention({ start: atIndex, end: atIndex + 1, query: "" });
    setActiveMentionIndex(0);
    recordComposerEvent("mention:open", { channelId, value: nextBody });
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(atIndex + 1, atIndex + 1);
    });
  }

  return (
    <div className="no-drag relative shrink-0 bg-background px-5 pb-4">
      {mention && mentionMatches.length > 0 && (
        <div className="absolute bottom-[142px] left-5 z-30 w-[320px] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">Mention teammate</div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {mentionMatches.map((member, index) => (
              <button
                key={member.id}
                type="button"
                className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent ${index === activeMentionIndex ? "bg-accent" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertMention(member);
                }}
              >
                <MemberAvatar member={member} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{member.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{member.title ?? member.status ?? "Teammate"}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mx-auto max-w-[1040px] rounded-lg border border-border bg-card shadow-sm">
        <textarea
          ref={textareaRef}
          value={body}
          placeholder={placeholder ?? `Message #${channelName}`}
          className="min-h-[74px] w-full resize-none bg-transparent px-4 py-3 text-[14px] leading-5 outline-none placeholder:text-muted-foreground"
          onFocus={() => recordComposerEvent("focus", { channelId, placeholder: placeholder ?? `Message #${channelName}` })}
          onChange={(event) => {
            const value = event.target.value;
            setBody(value);
            recordComposerEvent("input", { channelId, value, length: value.length });
            updateMentionState(value, event.target.selectionStart);
          }}
          onClick={(event) => updateMentionState(body, event.currentTarget.selectionStart)}
          onKeyUp={(event) => updateMentionState(body, event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            recordComposerEvent("key", {
              channelId,
              key: event.key,
              shiftKey: event.shiftKey,
              metaKey: event.metaKey,
              ctrlKey: event.ctrlKey,
              bodyLength: body.length,
            });
            if (mention && mentionMatches.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveMentionIndex((index) => (index + 1) % mentionMatches.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveMentionIndex((index) => (index - 1 + mentionMatches.length) % mentionMatches.length);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                insertMention(mentionMatches[activeMentionIndex] ?? mentionMatches[0]);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setMention(null);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex items-center gap-1 border-t border-border px-2 py-2">
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Add attachment">
            <Plus className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Shortcuts">
            <Zap className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Mention teammate" onClick={openMentionPicker}>
            <AtSign className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Emoji">
            <Smile className="size-4" />
          </Button>
          <Button variant="default" size="compact" className="ml-auto h-8" disabled={!body.trim()} onClick={() => void submit()}>
            <Send className="size-4" />
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function recordComposerEvent(event: string, payload: unknown, level: "info" | "warn" | "error" = "info"): void {
  recordDebugEvent({
    source: "composer",
    event,
    level,
    payload,
  });
}

function mentionAtCursor(value: string, cursor: number): MentionState | null {
  const beforeCursor = value.slice(0, cursor);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex === -1) {
    return null;
  }
  const query = beforeCursor.slice(atIndex + 1);
  if (query.includes("\n") || query.length > 40 || /[.,:;!?()[\]{}]/.test(query)) {
    return null;
  }
  if (atIndex > 0 && !/\s/.test(value[atIndex - 1])) {
    return null;
  }
  return { start: atIndex, end: cursor, query };
}
