import { Fragment, useCallback, useMemo, useRef } from "react";
import { GitCompareArrows } from "lucide-react";
import type { ConversationMessage } from "@/types/roder";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DotMatrixSpinner } from "@/components/ui/dot-matrix-spinner";
import { cn } from "@/lib/utils";
import { groupToolMessagesForTranscript } from "@/lib/tool-message-groups";
import { CompactToolGroup } from "./compact-tool-group";
import { MessageContent } from "./message-content";
import { PhaseMessage } from "./phase-message";
import { ToolActivityGroup } from "./tool-activity-group";
import { ToolTimelineItem } from "./tool-timeline-item";
import { ShimmerText } from "./tool-timeline-shared";
import { renderTextWithSkillTokens } from "@/components/skill-token-pill";
import { useSkillsStore } from "@/stores/skills-store";

type TranscriptProps = {
  messages: ConversationMessage[];
  followSignal: number;
  activeTurnId?: string;
  showWorkingIndicator?: boolean;
  threadChangeCount?: number;
  turnChangeCounts?: Record<string, number>;
  onCanScrollToBottomChange?: (canScrollToBottom: boolean) => void;
  onReviewThreadChanges?: () => void;
  onReviewTurnChanges?: (turnId: string) => void;
};

const bottomThresholdPx = 48;

export function Transcript({
  activeTurnId,
  messages,
  followSignal,
  showWorkingIndicator = false,
  threadChangeCount = 0,
  turnChangeCounts = {},
  onCanScrollToBottomChange,
  onReviewThreadChanges,
  onReviewTurnChanges,
}: TranscriptProps): React.JSX.Element {
  const skills = useSkillsStore((state) => state.skills);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const lastFollowSignalRef = useRef(followSignal);
  const lastMessageVersionRef = useRef("");

  const messageVersion = useMemo(() => {
    const lastMessage = messages.at(-1);
    return [
      messages.length,
      lastMessage?.id ?? "",
      lastMessage?.text.length ?? 0,
      lastMessage?.toolOutput?.length ?? 0,
      lastMessage?.toolSummary?.length ?? 0,
      lastMessage?.status ?? "",
      showWorkingIndicator ? "working" : "idle",
    ].join(":");
  }, [messages, showWorkingIndicator]);
  const transcriptEntries = useMemo(
    () => groupToolMessagesForTranscript(messages, { activeTurnId }),
    [activeTurnId, messages],
  );
  const turnBoundaryIndexes = useMemo(() => findTurnBoundaryIndexes(transcriptEntries), [transcriptEntries]);

  const syncPinnedState = useCallback(
    (viewport: HTMLDivElement) => {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const nextPinned = distanceFromBottom <= bottomThresholdPx;
      const wasPinned = pinnedToBottomRef.current;
      pinnedToBottomRef.current = nextPinned;
      if (wasPinned !== nextPinned) {
        onCanScrollToBottomChange?.(!nextPinned);
      }
    },
    [onCanScrollToBottomChange],
  );

  const setViewportNode = useCallback(
    (viewport: HTMLDivElement | null) => {
      viewportRef.current = viewport;
      if (!viewport) {
        return;
      }

      const followChanged = lastFollowSignalRef.current !== followSignal;
      const messageChanged = lastMessageVersionRef.current !== messageVersion;
      lastFollowSignalRef.current = followSignal;
      lastMessageVersionRef.current = messageVersion;

      if (followChanged) {
        pinnedToBottomRef.current = true;
        onCanScrollToBottomChange?.(false);
        requestAnimationFrame(() => {
          if (viewportRef.current === viewport) {
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
          }
        });
        return;
      }

      if (messageChanged) {
        requestAnimationFrame(() => {
          if (viewportRef.current !== viewport) {
            return;
          }
          if (pinnedToBottomRef.current) {
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
          }
          syncPinnedState(viewport);
        });
      }
    },
    [followSignal, messageVersion, onCanScrollToBottomChange, syncPinnedState],
  );

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea
        className="h-full"
        viewportClassName="transcript-viewport"
        viewportRef={setViewportNode}
        onViewportScroll={(event) => syncPinnedState(event.currentTarget)}
      >
        <main className="mx-auto flex w-full max-w-[980px] flex-col px-8 pb-40 pt-2">
          {threadChangeCount > 0 && onReviewThreadChanges && (
            <div className="mb-2 flex justify-end">
              <ChangesLink label="Changes" count={threadChangeCount} onClick={onReviewThreadChanges} />
            </div>
          )}
          {transcriptEntries.map((entry, index) => {
            const message = entry.kind === "message" ? entry.message : undefined;
            const turnId = entryTurnId(entry);
            const turnChangeCount = turnId ? (turnChangeCounts[turnId] ?? 0) : 0;
            const showTurnChanges =
              turnId !== undefined &&
              turnChangeCount > 0 &&
              onReviewTurnChanges &&
              turnBoundaryIndexes.has(index);
            const previousIsTool = isToolEntry(transcriptEntries[index - 1]);
            const nextIsTool = isToolEntry(transcriptEntries[index + 1]);
            const entryIsTool = isToolEntry(entry);
            const isPhaseMessage =
              message?.role === "assistant" && Boolean(message.phase && message.phase !== "final_answer");

            return (
              <Fragment key={entry.kind === "message" ? entry.message.id : entry.id}>
                <article
                  className={cn(
                    "text-foreground",
                    !entryIsTool && "my-3",
                    isPhaseMessage && "my-4",
                    entryIsTool && "my-0",
                    entryIsTool && !previousIsTool && "mt-2",
                    entryIsTool && !nextIsTool && "mb-2",
                    message?.role === "user" && "rounded-[14px] bg-card px-4 py-3 text-base",
                  )}
                >
                  {entry.kind === "activityGroup" ? (
                    <ToolActivityGroup entries={entry.entries} summary={entry.summary} />
                  ) : entry.kind === "readFileGroup" ? (
                    <CompactToolGroup kind="readFile" messages={entry.messages} />
                  ) : entry.kind === "readSkillGroup" ? (
                    <CompactToolGroup kind="readSkill" messages={entry.messages} />
                  ) : entry.kind === "searchGroup" ? (
                    <CompactToolGroup kind="search" messages={entry.messages} />
                  ) : message?.role === "tool" ? (
                    <ToolTimelineItem message={message} />
                  ) : isPhaseMessage ? (
                    <PhaseMessage
                      isStreaming={message.status === "streaming"}
                      skills={skills}
                      text={message.text || (message.status === "streaming" ? " " : "")}
                    />
                  ) : message?.role === "assistant" ? (
                    <MessageContent
                      isStreaming={message.status === "streaming"}
                      skills={skills}
                      text={message.text || (message.status === "streaming" ? " " : "")}
                    />
                  ) : (
                    <div className="font-medium text-base leading-[1.55]">
                      {renderTextWithSkillTokens(message?.text ?? "", skills)}
                    </div>
                  )}
                </article>
                {showTurnChanges && turnId && onReviewTurnChanges && (
                  <div className="mb-3 flex justify-start">
                    <ChangesLink
                      label="Turn changes"
                      count={turnChangeCount}
                      onClick={() => onReviewTurnChanges(turnId)}
                    />
                  </div>
                )}
              </Fragment>
            );
          })}
          {showWorkingIndicator && <ThreadWorkingIndicator />}
        </main>
      </ScrollArea>
      <div className="transcript-fade pointer-events-none absolute inset-x-0 bottom-0 h-28" />
    </div>
  );
}

function ChangesLink({
  label,
  count,
  onClick,
}: {
  label: string;
  count: number;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <Button variant="ghost" size="sm" className="h-8 rounded-md px-2.5 text-muted-foreground" onClick={onClick}>
      <GitCompareArrows className="size-3.5" />
      <span>{label}</span>
      <span className="rounded-md bg-muted px-1.5 py-0.5 text-base text-muted-foreground">{count}</span>
    </Button>
  );
}

function ThreadWorkingIndicator(): React.JSX.Element {
  return (
    <div
      aria-label="Agent is working"
      aria-live="polite"
      className="my-3 flex h-8 items-center gap-2 text-base font-medium text-muted-foreground"
      role="status"
    >
      <DotMatrixSpinner />
      <ShimmerText>Working</ShimmerText>
    </div>
  );
}

function isToolEntry(entry: ReturnType<typeof groupToolMessagesForTranscript>[number] | undefined): boolean {
  return (
    entry?.kind === "activityGroup" ||
    entry?.kind === "readFileGroup" ||
    entry?.kind === "readSkillGroup" ||
    entry?.kind === "searchGroup" ||
    entry?.message.role === "tool"
  );
}

function entryTurnId(entry: ReturnType<typeof groupToolMessagesForTranscript>[number]): string | undefined {
  if (entry.kind === "message") {
    return entry.message.turnId;
  }
  if (entry.kind === "activityGroup") {
    return entry.entries.flatMap(entryMessages).find((message) => message.turnId)?.turnId;
  }
  return entry.messages.find((message) => message.turnId)?.turnId;
}

function findTurnBoundaryIndexes(entries: ReturnType<typeof groupToolMessagesForTranscript>): Set<number> {
  const boundaries = new Set<number>();
  let nextTurnId: string | undefined;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const turnId = entryTurnId(entries[index]);
    if (!turnId) {
      continue;
    }
    if (!nextTurnId || nextTurnId !== turnId) {
      boundaries.add(index);
    }
    nextTurnId = turnId;
  }

  return boundaries;
}

function entryMessages(entry: Parameters<typeof isToolEntry>[0]): ConversationMessage[] {
  if (!entry) {
    return [];
  }
  if (entry.kind === "message") {
    return [entry.message];
  }
  if (entry.kind === "activityGroup") {
    return entry.entries.flatMap(entryMessages);
  }
  return entry.messages;
}
