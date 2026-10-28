import { useRef, useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { roderIpc } from "@/lib/roder-ipc";
import { scanTranscriptNavigationHistory } from "@/lib/transcript-navigation-history";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  transcriptNavigationKeyIndex,
  transcriptNavigationPreview,
  mergeTranscriptNavigation,
  type TranscriptNavigationItem,
} from "@/lib/transcript-navigation";
import type { ConversationMessage } from "@/types/roder";
import { cn } from "@/lib/utils";

type TranscriptNavigationProps = {
  items: TranscriptNavigationItem[];
  messages: readonly ConversationMessage[];
  activeId: string | null;
  bottomInsetPx: number;
  onSelect: (id: string) => void;
  history?: { threadId: string; before: string | null };
};

export function TranscriptNavigation({
  items,
  messages,
  activeId,
  bottomInsetPx,
  onSelect,
  history,
}: TranscriptNavigationProps): React.JSX.Element | null {
  const navigationRef = useRef<HTMLElement | null>(null);
  const scanIdRef = useRef(0);
  const [olderItems, setOlderItems] = useState<TranscriptNavigationItem[]>([]);
  const [loadingScanId, setLoadingScanId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const navigationItems = mergeTranscriptNavigation(olderItems, items);
  const loading = loadingScanId !== null;
  const messageTextById = new Map(messages.map((message) => [message.id, message.text]));
  const tabStopId = navigationItems.some((item) => item.id === focusedId)
    ? focusedId
    : (activeId ?? navigationItems[0]?.id);

  async function loadHistory(): Promise<void> {
    if (!history?.before) return;
    const scanId = ++scanIdRef.current;
    setLoadingScanId(scanId);
    setError(null);
    try {
      await scanTranscriptNavigationHistory({
        ...history,
        readPage: roderIpc.readThreadHistory,
        isCancelled: () => scanIdRef.current !== scanId,
        onPage: (page) => setOlderItems((previous) => mergeTranscriptNavigation(page, previous)),
      });
    } catch (cause) {
      if (scanIdRef.current === scanId) setError((cause as Error).message);
    } finally {
      setLoadingScanId((current) => (current === scanId ? null : current));
    }
  }

  useMountEffect(() => {
    void loadHistory();
    return () => {
      scanIdRef.current += 1;
    };
  });
  if (!navigationItems.length && !loading && !error) return null;

  return (
    <nav
      ref={navigationRef}
      aria-label="Your message navigation"
      className="absolute left-0 top-4 z-20 flex w-5 flex-col justify-center"
      style={{ bottom: Math.max(16, bottomInsetPx) }}
    >
      <TooltipProvider delay={120}>
        {loading && (
          <span role="status" className="sr-only">
            Loading your older message markers
          </span>
        )}
        {error && (
          <button
            type="button"
            aria-label="Retry loading your message navigation"
            title={error}
            className="text-xs text-muted-foreground"
            onClick={() => void loadHistory()}
          >
            !
          </button>
        )}
        <div className="max-h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navigationItems.map((item, index) => {
            const active = item.id === activeId;
            const preview = transcriptNavigationPreview(messageTextById.get(item.id)?.trim() || item.preview);
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger
                  type="button"
                  data-transcript-nav={item.id}
                  tabIndex={tabStopId === item.id ? 0 : -1}
                  aria-label={`Jump to your message ${index + 1}: ${item.preview}`}
                  aria-current={active ? "location" : undefined}
                  className="group/nav-tick flex h-2 w-5 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onFocus={() => setFocusedId(item.id)}
                  onClick={() => onSelect(item.id)}
                  onKeyDown={(event) => {
                    const nextIndex = transcriptNavigationKeyIndex(event.key, index, navigationItems.length);
                    if (nextIndex === null) return;
                    event.preventDefault();
                    navigationRef.current
                      ?.querySelectorAll<HTMLButtonElement>("button[data-transcript-nav]")
                      [nextIndex]?.focus();
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none h-0.5 rounded-full transition-[width,background-color] duration-150 motion-reduce:transition-none",
                      active
                        ? "w-3.5 bg-foreground/80"
                        : "w-2 bg-muted-foreground/30 group-hover/nav-tick:w-3.5 group-hover/nav-tick:bg-muted-foreground/70 group-focus-visible/nav-tick:w-3.5",
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={12}
                  className="w-80 max-w-[calc(100vw-3rem)] rounded-xl bg-popover p-3 font-mono text-base text-popover-foreground shadow-md ring-1 ring-border/70"
                >
                  <p
                    className={cn(
                      "font-medium leading-relaxed",
                      preview.body ? "truncate" : "line-clamp-4 break-words",
                    )}
                  >
                    {preview.title}
                  </p>
                  {preview.body ? (
                    <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words font-normal leading-relaxed text-muted-foreground">
                      {preview.body}
                    </p>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </nav>
  );
}
