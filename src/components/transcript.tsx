import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationMessage } from "@/types/roder";
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

type TranscriptProps = {
  messages: ConversationMessage[];
  followSignal: number;
  activeTurnId?: string;
  showWorkingIndicator?: boolean;
};

const bottomThresholdPx = 48;

export function Transcript({ activeTurnId, messages, followSignal, showWorkingIndicator = false }: TranscriptProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);

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
  const transcriptEntries = useMemo(() => groupToolMessagesForTranscript(messages, { activeTurnId }), [activeTurnId, messages]);

  const syncPinnedState = useCallback((viewport: HTMLDivElement) => {
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const nextPinned = distanceFromBottom <= bottomThresholdPx;
    const wasPinned = pinnedToBottomRef.current;
    pinnedToBottomRef.current = nextPinned;
    if (wasPinned !== nextPinned) {
      setIsPinnedToBottom(nextPinned);
    }
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (!pinnedToBottomRef.current) {
      return;
    }
    requestAnimationFrame(() => scrollToBottom("auto"));
  }, [messageVersion, scrollToBottom]);

  useEffect(() => {
    pinnedToBottomRef.current = true;
    setIsPinnedToBottom(true);
    requestAnimationFrame(() => scrollToBottom("smooth"));
  }, [followSignal, scrollToBottom]);

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea
        className="h-full"
        viewportClassName="transcript-viewport"
        viewportRef={viewportRef}
        onViewportScroll={(event) => syncPinnedState(event.currentTarget)}
      >
        <main className="mx-auto flex w-full max-w-[980px] flex-col px-8 pb-40 pt-2">
          {transcriptEntries.map((entry, index) => {
            const message = entry.kind === "message" ? entry.message : undefined;
            const previousIsTool = isToolEntry(transcriptEntries[index - 1]);
            const nextIsTool = isToolEntry(transcriptEntries[index + 1]);
            const entryIsTool = isToolEntry(entry);
            const isPhaseMessage = message?.role === "assistant" && Boolean(message.phase && message.phase !== "final_answer");

            return (
              <article
                key={entry.kind === "message" ? entry.message.id : entry.id}
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
                  <PhaseMessage isStreaming={message.status === "streaming"} text={message.text || (message.status === "streaming" ? " " : "")} />
                ) : message?.role === "assistant" ? (
                  <MessageContent isStreaming={message.status === "streaming"} text={message.text || (message.status === "streaming" ? " " : "")} />
                ) : (
                  <div className="font-medium text-base leading-[1.55]">{message?.text}</div>
                )}
              </article>
            );
          })}
          {showWorkingIndicator && <ThreadWorkingIndicator />}
        </main>
      </ScrollArea>
      <div className="transcript-fade pointer-events-none absolute inset-x-0 bottom-0 h-28" />
      <div data-transcript-pinned={isPinnedToBottom ? "true" : "false"} className="sr-only" />
    </div>
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
  return entry?.kind === "activityGroup"
    || entry?.kind === "readFileGroup"
    || entry?.kind === "readSkillGroup"
    || entry?.kind === "searchGroup"
    || entry?.message.role === "tool";
}
