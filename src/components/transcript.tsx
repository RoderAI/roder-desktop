import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationMessage } from "@/types/gode";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { MessageContent } from "./message-content";
import { PhaseMessage } from "./phase-message";
import { ToolTimelineItem } from "./tool-timeline-item";

type TranscriptProps = {
  messages: ConversationMessage[];
  followSignal: number;
};

const bottomThresholdPx = 48;

export function Transcript({ messages, followSignal }: TranscriptProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottomRef = useRef(true);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);

  const messageVersion = useMemo(() => {
    const lastMessage = messages.at(-1);
    return `${messages.length}:${lastMessage?.id ?? ""}:${lastMessage?.text.length ?? 0}:${lastMessage?.status ?? ""}`;
  }, [messages]);

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
          {messages.map((message, index) => {
            const previousIsTool = messages[index - 1]?.role === "tool";
            const nextIsTool = messages[index + 1]?.role === "tool";
            const isPhaseMessage = message.role === "assistant" && Boolean(message.phase && message.phase !== "final_answer");

            return (
              <article
                key={message.id}
                className={cn(
                  "text-foreground",
                  message.role !== "tool" && "my-3",
                  isPhaseMessage && "my-4",
                  message.role === "tool" && "my-0",
                  message.role === "tool" && !previousIsTool && "mt-2",
                  message.role === "tool" && !nextIsTool && "mb-2",
                  message.role === "user" && "rounded-[14px] bg-card px-4 py-3 text-[16px] shadow-sm ring-1 ring-border",
                )}
              >
                {message.role === "tool" ? (
                  <ToolTimelineItem message={message} />
                ) : isPhaseMessage ? (
                  <PhaseMessage text={message.text || (message.status === "streaming" ? " " : "")} />
                ) : message.role === "assistant" ? (
                  <MessageContent text={message.text || (message.status === "streaming" ? " " : "")} />
                ) : (
                  <div className="text-[16px] leading-7">{message.text}</div>
                )}
              </article>
            );
          })}
        </main>
      </ScrollArea>
      <div className="transcript-fade pointer-events-none absolute inset-x-0 bottom-0 h-28" />
      <div data-transcript-pinned={isPinnedToBottom ? "true" : "false"} className="sr-only" />
    </div>
  );
}
