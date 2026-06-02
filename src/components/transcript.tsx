import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type WheelEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { GitCompareArrows } from "lucide-react";
import type { ConversationMessage, SkillDescriptor } from "@/types/roder";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DotMatrixSpinner } from "@/components/ui/dot-matrix-spinner";
import { cn } from "@/lib/utils";
import {
  pruneTranscriptDisclosureState,
  setTranscriptDisclosureOpen,
  type TranscriptDisclosureState,
} from "@/lib/transcript-disclosure-state";
import {
  canScrollTranscriptRowsToBottom,
  nextTranscriptPinnedToEnd,
  shouldShowTranscriptScrollAffordance,
  transcriptFollowAction,
  transcriptScrollRestorationAction,
  transcriptScrollRestorationStateFromViewport,
  transcriptScrollAffordanceThresholdPx,
  type TranscriptScrollRestorationState,
} from "@/lib/transcript-scroll";
import {
  buildTranscriptRows,
  transcriptNestedDisclosureKey,
  transcriptRowDisclosureKeys,
  transcriptRowsSearchText,
  type TranscriptEntryRow,
  type TranscriptRow,
} from "@/lib/transcript-rows";
import { CompactToolGroup } from "./compact-tool-group";
import { MessageContent } from "./message-content";
import { PhaseMessage } from "./phase-message";
import { ToolActivityGroup } from "./tool-activity-group";
import { ToolTimelineItem } from "./tool-timeline-item";
import { ShimmerText } from "./tool-timeline-shared";
import { UserMessageContent } from "@/components/user-message-content";
import { useSkillsStore } from "@/stores/skills-store";

type TranscriptProps = {
  messages: ConversationMessage[];
  followSignal: number;
  bottomInsetPx?: number;
  activeTurnId?: string;
  scrollStateKey?: string;
  showWorkingIndicator?: boolean;
  threadChangeCount?: number;
  turnChangeCounts?: Record<string, number>;
  onCanScrollToBottomChange?: (canScrollToBottom: boolean) => void;
  onReviewThreadChanges?: () => void;
  onReviewTurnChanges?: (turnId: string) => void;
};

const defaultTranscriptScrollStateKey = "default";
const transcriptScrollStateByKey = new Map<string, TranscriptScrollRestorationState>();

export function Transcript({
  activeTurnId,
  bottomInsetPx = 0,
  messages,
  followSignal,
  scrollStateKey = defaultTranscriptScrollStateKey,
  showWorkingIndicator = false,
  threadChangeCount = 0,
  turnChangeCounts = {},
  onCanScrollToBottomChange,
  onReviewThreadChanges,
  onReviewTurnChanges,
}: TranscriptProps): React.JSX.Element {
  const skills = useSkillsStore((state) => state.skills);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastCanScrollToBottomRef = useRef<boolean | null>(null);
  const lastFollowSignalRef = useRef(followSignal);
  const lastTranscriptVersionRef = useRef("");
  const pendingScrollFrameRef = useRef<number | null>(null);
  const pinnedToEndRef = useRef(true);
  const previousScrollTopRef = useRef(0);
  const scrollObservationVersionRef = useRef(0);
  const restoredScrollStateKeyRef = useRef<string | null>(null);
  const scrollStateKeyRef = useRef(scrollStateKey);
  const transcriptRowsRef = useRef<TranscriptRow[]>([]);
  const transcriptRowKeysRef = useRef<Array<string | number>>([]);
  const userScrollIntentRef = useRef(false);
  const userScrollIntentTimeoutRef = useRef<number | null>(null);
  const [disclosureOpenByKey, setDisclosureOpenByKey] = useState<TranscriptDisclosureState>({});
  const [pinnedToEnd, setPinnedToEnd] = useState(true);

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
      bottomInsetPx,
    ].join(":");
  }, [bottomInsetPx, messages, showWorkingIndicator]);
  const transcriptRows = useMemo(
    () =>
      buildTranscriptRows({
        activeTurnId,
        messages,
        showWorkingIndicator,
        threadChangeCount: onReviewThreadChanges ? threadChangeCount : 0,
        turnChangeCounts: onReviewTurnChanges ? turnChangeCounts : {},
      }),
    [
      activeTurnId,
      messages,
      onReviewThreadChanges,
      onReviewTurnChanges,
      showWorkingIndicator,
      threadChangeCount,
      turnChangeCounts,
    ],
  );
  const transcriptRowKeys = useMemo(() => transcriptRows.map((row) => row.key), [transcriptRows]);
  const rowKeyVersion = useMemo(() => transcriptRowKeys.join("\u0000"), [transcriptRowKeys]);
  const transcriptVersion = useMemo(() => [messageVersion, rowKeyVersion].join("\n"), [messageVersion, rowKeyVersion]);
  const transcriptHasActiveStreaming = useMemo(
    () =>
      showWorkingIndicator ||
      messages.some((message) => message.status === "streaming" || message.toolStatus === "running"),
    [messages, showWorkingIndicator],
  );
  scrollStateKeyRef.current = scrollStateKey;
  transcriptRowsRef.current = transcriptRows;
  transcriptRowKeysRef.current = transcriptRowKeys;

  const reportCanScrollToBottom = useCallback(
    (canScroll: boolean) => {
      if (lastCanScrollToBottomRef.current !== canScroll) {
        lastCanScrollToBottomRef.current = canScroll;
        onCanScrollToBottomChange?.(canScroll);
      }
    },
    [onCanScrollToBottomChange],
  );
  const disclosureKeys = useMemo(() => transcriptRows.flatMap(transcriptRowDisclosureKeys), [transcriptRows]);
  const setDisclosureOpen = useCallback((key: string, open: boolean) => {
    setDisclosureOpenByKey((state) => setTranscriptDisclosureOpen(state, key, open));
  }, []);
  const setPinnedToEndState = useCallback((nextPinnedToEnd: boolean) => {
    pinnedToEndRef.current = nextPinnedToEnd;
    setPinnedToEnd((currentPinnedToEnd) =>
      currentPinnedToEnd === nextPinnedToEnd ? currentPinnedToEnd : nextPinnedToEnd,
    );
  }, []);
  const rememberTranscriptScrollState = useCallback((key: string) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    transcriptScrollStateByKey.set(
      key,
      transcriptScrollRestorationStateFromViewport({
        clientHeight: viewport.clientHeight,
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      }),
    );
  }, []);

  useEffect(() => {
    setDisclosureOpenByKey((state) => pruneTranscriptDisclosureState(state, disclosureKeys));
  }, [disclosureKeys]);

  const getTranscriptRowKey = useCallback((index: number) => transcriptRowKeysRef.current[index] ?? index, []);
  const estimateTranscriptVirtualRowSize = useCallback(
    (index: number) => estimateTranscriptRowSize(transcriptRowsRef.current[index]),
    [],
  );
  const getTranscriptScrollElement = useCallback(() => viewportRef.current, []);
  const syncTranscriptScrollState = useCallback(
    ({
      source,
      userScrollIntent,
    }: {
      source: { isAtEnd: (threshold?: number) => boolean };
      userScrollIntent: boolean;
    }) => {
      const rowCount = transcriptRowsRef.current.length;
      const observedCanScrollToBottom = canScrollTranscriptRowsToBottom({
        rowCount,
        source,
      });
      const nextPinnedToEnd = nextTranscriptPinnedToEnd({
        observedCanScrollToBottom,
        pinnedToEnd: pinnedToEndRef.current,
        userScrollIntent,
      });
      setPinnedToEndState(nextPinnedToEnd);
      reportCanScrollToBottom(
        shouldShowTranscriptScrollAffordance({
          observedCanScrollToBottom,
          pinnedToEnd: nextPinnedToEnd,
          rowCount,
        }),
      );
    },
    [reportCanScrollToBottom, setPinnedToEndState],
  );
  const handleVirtualizerChange = useCallback(
    (virtualizer: { isAtEnd: (threshold?: number) => boolean }) => {
      syncTranscriptScrollState({
        source: virtualizer,
        userScrollIntent: userScrollIntentRef.current,
      });
      rememberTranscriptScrollState(scrollStateKeyRef.current);
      userScrollIntentRef.current = false;
      if (userScrollIntentTimeoutRef.current !== null) {
        window.clearTimeout(userScrollIntentTimeoutRef.current);
        userScrollIntentTimeoutRef.current = null;
      }
    },
    [rememberTranscriptScrollState, syncTranscriptScrollState],
  );
  const cancelPendingScrollFrame = useCallback(() => {
    if (pendingScrollFrameRef.current === null) {
      return;
    }
    cancelAnimationFrame(pendingScrollFrameRef.current);
    pendingScrollFrameRef.current = null;
  }, []);
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    anchorTo: "end",
    count: transcriptRows.length,
    estimateSize: estimateTranscriptVirtualRowSize,
    followOnAppend: "auto",
    getItemKey: getTranscriptRowKey,
    getScrollElement: getTranscriptScrollElement,
    onChange: handleVirtualizerChange,
    overscan: 8,
    paddingEnd: bottomInsetPx,
    scrollEndThreshold: transcriptScrollAffordanceThresholdPx,
  });

  const syncCanScrollToBottom = useCallback(() => {
    scrollObservationVersionRef.current += 1;
    const currentScrollTop = viewportRef.current?.scrollTop ?? 0;
    const userScrolledTowardStart = currentScrollTop < previousScrollTopRef.current - 1;
    previousScrollTopRef.current = currentScrollTop;
    syncTranscriptScrollState({
      source: rowVirtualizer,
      userScrollIntent: userScrollIntentRef.current || userScrolledTowardStart,
    });
    rememberTranscriptScrollState(scrollStateKeyRef.current);
    userScrollIntentRef.current = false;
    if (userScrollIntentTimeoutRef.current !== null) {
      window.clearTimeout(userScrollIntentTimeoutRef.current);
      userScrollIntentTimeoutRef.current = null;
    }
  }, [rememberTranscriptScrollState, rowVirtualizer, syncTranscriptScrollState]);

  const scheduleScrollToEnd = useCallback(
    (behavior: ScrollBehavior, expectedScrollObservationVersion?: number) => {
      cancelPendingScrollFrame();
      const scrollToEnd = () => {
        if (
          expectedScrollObservationVersion !== undefined &&
          scrollObservationVersionRef.current !== expectedScrollObservationVersion &&
          !pinnedToEndRef.current
        ) {
          return;
        }
        rowVirtualizer.scrollToEnd({ behavior });
        previousScrollTopRef.current = viewportRef.current?.scrollTop ?? previousScrollTopRef.current;
      };
      scrollToEnd();
      pendingScrollFrameRef.current = requestAnimationFrame(() => {
        pendingScrollFrameRef.current = null;
        scrollToEnd();
      });
    },
    [cancelPendingScrollFrame, rowVirtualizer],
  );
  const scheduleScrollToOffset = useCallback(
    (offset: number) => {
      cancelPendingScrollFrame();
      const scrollOffset = Math.max(0, offset);
      const scrollToOffset = () => {
        rowVirtualizer.scrollToOffset(scrollOffset, { behavior: "auto" });
        previousScrollTopRef.current = viewportRef.current?.scrollTop ?? scrollOffset;
      };
      scrollToOffset();
      pendingScrollFrameRef.current = requestAnimationFrame(() => {
        pendingScrollFrameRef.current = null;
        scrollToOffset();
      });
    },
    [cancelPendingScrollFrame, rowVirtualizer],
  );

  const setViewportNode = useCallback((viewport: HTMLDivElement | null) => {
    viewportRef.current = viewport;
  }, []);
  const markUserScrollIntent = useCallback(() => {
    userScrollIntentRef.current = true;
    if (userScrollIntentTimeoutRef.current !== null) {
      window.clearTimeout(userScrollIntentTimeoutRef.current);
    }
    userScrollIntentTimeoutRef.current = window.setTimeout(() => {
      userScrollIntentRef.current = false;
      userScrollIntentTimeoutRef.current = null;
    }, 200);
  }, []);
  const handleViewportWheelCapture = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (event.deltaY < 0 || !pinnedToEndRef.current) {
        markUserScrollIntent();
      }
    },
    [markUserScrollIntent],
  );
  const handleViewportKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        event.key === "ArrowUp" ||
        event.key === "PageUp" ||
        event.key === "Home" ||
        event.key === "ArrowDown" ||
        event.key === "PageDown" ||
        event.key === "End" ||
        event.key === " "
      ) {
        markUserScrollIntent();
      }
    },
    [markUserScrollIntent],
  );

  useEffect(
    () => () => {
      cancelPendingScrollFrame();
      if (userScrollIntentTimeoutRef.current !== null) {
        window.clearTimeout(userScrollIntentTimeoutRef.current);
        userScrollIntentTimeoutRef.current = null;
      }
    },
    [cancelPendingScrollFrame],
  );

  useLayoutEffect(() => {
    return () => rememberTranscriptScrollState(scrollStateKeyRef.current);
  }, [rememberTranscriptScrollState]);

  useLayoutEffect(() => {
    if (restoredScrollStateKeyRef.current === scrollStateKey) {
      return;
    }
    restoredScrollStateKeyRef.current = scrollStateKey;
    lastFollowSignalRef.current = followSignal;
    lastTranscriptVersionRef.current = transcriptVersion;
    userScrollIntentRef.current = false;
    if (userScrollIntentTimeoutRef.current !== null) {
      window.clearTimeout(userScrollIntentTimeoutRef.current);
      userScrollIntentTimeoutRef.current = null;
    }

    const restorationAction = transcriptScrollRestorationAction({
      restoredState: transcriptScrollStateByKey.get(scrollStateKey),
      rowCount: transcriptRowsRef.current.length,
    });

    setPinnedToEndState(restorationAction.pinnedToEnd);
    reportCanScrollToBottom(
      restorationAction.kind === "offset" && !restorationAction.pinnedToEnd && transcriptRowsRef.current.length > 0,
    );
    if (restorationAction.kind === "end") {
      scheduleScrollToEnd("auto");
      return;
    }
    scheduleScrollToOffset(restorationAction.scrollOffset);
  }, [
    followSignal,
    reportCanScrollToBottom,
    scheduleScrollToEnd,
    scheduleScrollToOffset,
    scrollStateKey,
    setPinnedToEndState,
    transcriptVersion,
  ]);

  useLayoutEffect(() => {
    if (transcriptRows.length > 0) {
      return;
    }
    setPinnedToEndState(true);
    cancelPendingScrollFrame();
    reportCanScrollToBottom(false);
  }, [cancelPendingScrollFrame, reportCanScrollToBottom, setPinnedToEndState, transcriptRows.length]);

  useLayoutEffect(() => {
    const followChanged = lastFollowSignalRef.current !== followSignal;
    const transcriptChanged = lastTranscriptVersionRef.current !== transcriptVersion;
    lastFollowSignalRef.current = followSignal;
    lastTranscriptVersionRef.current = transcriptVersion;

    const followAction = transcriptFollowAction({
      followSignalChanged: followChanged,
      pinnedToEnd: pinnedToEndRef.current,
      scrollObservationVersion: scrollObservationVersionRef.current,
      transcriptChanged,
    });

    if (followAction.kind === "explicit") {
      setPinnedToEndState(true);
      reportCanScrollToBottom(false);
      scheduleScrollToEnd(followAction.behavior);
      return;
    }

    if (followAction.kind === "auto") {
      setPinnedToEndState(true);
      reportCanScrollToBottom(false);
      scheduleScrollToEnd(followAction.behavior, followAction.scrollObservationVersion);
    }
  }, [followSignal, reportCanScrollToBottom, scheduleScrollToEnd, setPinnedToEndState, transcriptVersion]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const transcriptSearchText = useMemo(() => {
    const mountedRowKeys = new Set(virtualItems.map((virtualItem) => String(virtualItem.key)));
    return transcriptRowsSearchText(transcriptRows, {
      excludedRowKeys: mountedRowKeys,
    });
  }, [transcriptRows, virtualItems]);
  const suppressAutoFollowScrollbar = transcriptHasActiveStreaming && pinnedToEnd;

  return (
    <div className="relative min-h-0 flex-1">
      <TranscriptSearchMirror text={transcriptSearchText} />
      <TranscriptWorkingLiveRegion active={showWorkingIndicator} />
      <ScrollArea
        className="h-full"
        viewportClassName={cn(
          "workspace-scrollbar transcript-viewport",
          suppressAutoFollowScrollbar && "transcript-viewport-auto-following",
        )}
        viewportProps={{
          onKeyDownCapture: handleViewportKeyDownCapture,
          onTouchStartCapture: markUserScrollIntent,
          onWheelCapture: handleViewportWheelCapture,
        }}
        viewportRef={setViewportNode}
        onViewportScroll={syncCanScrollToBottom}
      >
        <main className="mx-auto w-full max-w-3xl px-8 pt-2">
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualItems.map((virtualItem) => {
              const row = transcriptRows[virtualItem.index];
              if (!row) {
                return null;
              }
              const rowKey = String(virtualItem.key);
              const rowSpacing = transcriptRowSpacing(row);
              return (
                <div
                  className={rowSpacing}
                  data-index={virtualItem.index}
                  key={rowKey}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    left: 0,
                    position: "absolute",
                    top: 0,
                    transform: `translateY(${virtualItem.start}px)`,
                    width: "100%",
                  }}
                >
                  <TranscriptRowView
                    disclosureOpenByKey={disclosureOpenByKey}
                    onDisclosureOpenChange={setDisclosureOpen}
                    onReviewThreadChanges={onReviewThreadChanges}
                    onReviewTurnChanges={onReviewTurnChanges}
                    row={row}
                    skills={skills}
                  />
                </div>
              );
            })}
          </div>
        </main>
      </ScrollArea>
    </div>
  );
}

function TranscriptRowView({
  disclosureOpenByKey,
  onDisclosureOpenChange,
  onReviewThreadChanges,
  onReviewTurnChanges,
  row,
  skills,
}: {
  disclosureOpenByKey: TranscriptDisclosureState;
  onDisclosureOpenChange: (key: string, open: boolean) => void;
  onReviewThreadChanges?: () => void;
  onReviewTurnChanges?: (turnId: string) => void;
  row: TranscriptRow;
  skills: SkillDescriptor[];
}): React.JSX.Element | null {
  if (row.kind === "threadReviewChanges") {
    if (!onReviewThreadChanges) {
      return null;
    }
    return (
      <div className="flex justify-end">
        <ChangesLink label="Changes" count={row.count} onClick={onReviewThreadChanges} />
      </div>
    );
  }

  if (row.kind === "turnReviewChanges") {
    if (!onReviewTurnChanges) {
      return null;
    }
    return (
      <div className="flex justify-start">
        <ChangesLink label="Turn changes" count={row.count} onClick={() => onReviewTurnChanges(row.turnId)} />
      </div>
    );
  }

  if (row.kind === "working") {
    return <ThreadWorkingIndicator />;
  }

  return (
    <TranscriptEntryView
      disclosureOpenByKey={disclosureOpenByKey}
      onDisclosureOpenChange={onDisclosureOpenChange}
      row={row}
      skills={skills}
    />
  );
}

function TranscriptEntryView({
  disclosureOpenByKey,
  onDisclosureOpenChange,
  row,
  skills,
}: {
  disclosureOpenByKey: TranscriptDisclosureState;
  onDisclosureOpenChange: (key: string, open: boolean) => void;
  row: TranscriptEntryRow;
  skills: SkillDescriptor[];
}): React.JSX.Element {
  const entry = row.entry;
  const message = entry.kind === "message" ? entry.message : undefined;
  const isPhaseMessage = message?.role === "assistant" && Boolean(message.phase && message.phase !== "final_answer");
  const getDisclosureControl = (key: string) => ({
    onOpenChange: (open: boolean) => onDisclosureOpenChange(key, open),
    open: disclosureOpenByKey[key] ?? false,
  });
  const rowDisclosureKey = row.disclosureKey;
  const disclosureControl = rowDisclosureKey ? getDisclosureControl(rowDisclosureKey) : {};
  const getEntryDisclosureControl =
    rowDisclosureKey && entry.kind === "activityGroup"
      ? (activityEntry: (typeof entry.entries)[number]) => {
          const nestedDisclosureKey = transcriptNestedDisclosureKey(rowDisclosureKey, activityEntry);
          return nestedDisclosureKey ? getDisclosureControl(nestedDisclosureKey) : {};
        }
      : undefined;

  return (
    <article
      className={cn("text-foreground", message?.role === "user" && "rounded-[14px] bg-card px-4 py-3 text-base")}
    >
      {entry.kind === "activityGroup" ? (
        <ToolActivityGroup
          entries={entry.entries}
          getEntryDisclosureControl={getEntryDisclosureControl}
          summary={entry.summary}
          {...disclosureControl}
        />
      ) : entry.kind === "readFileGroup" ? (
        <CompactToolGroup kind="readFile" messages={entry.messages} {...disclosureControl} />
      ) : entry.kind === "readSkillGroup" ? (
        <CompactToolGroup kind="readSkill" messages={entry.messages} {...disclosureControl} />
      ) : entry.kind === "searchGroup" ? (
        <CompactToolGroup kind="search" messages={entry.messages} {...disclosureControl} />
      ) : message?.role === "tool" ? (
        <ToolTimelineItem message={message} {...disclosureControl} />
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
        <UserMessageContent images={message?.images} skills={skills} text={message?.text ?? ""} />
      )}
    </article>
  );
}

function transcriptRowSpacing(row: TranscriptRow): string {
  if (row.kind === "threadReviewChanges") {
    return "pb-2";
  }
  if (row.kind === "turnReviewChanges") {
    return "pb-3";
  }
  if (row.kind === "working") {
    return "py-1.5";
  }

  const message = row.entry.kind === "message" ? row.entry.message : undefined;
  const isPhaseMessage = message?.role === "assistant" && Boolean(message.phase && message.phase !== "final_answer");
  return cn(
    !row.entryIsTool && "py-1.5",
    isPhaseMessage && "py-2",
    row.entryIsTool && "py-0",
    row.entryIsTool && !row.previousIsTool && "pt-1.5",
    row.entryIsTool && !row.nextIsTool && "pb-1.5",
  );
}

function estimateTranscriptRowSize(row: TranscriptRow | undefined): number {
  if (!row) {
    return 72;
  }
  if (row.kind === "threadReviewChanges" || row.kind === "turnReviewChanges") {
    return 40;
  }
  if (row.kind === "working") {
    return 56;
  }
  if (row.entryIsTool) {
    return 36;
  }
  if (row.entry.kind === "message" && row.entry.message.role === "user") {
    return 72;
  }
  return 120;
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
    <div aria-hidden="true" className="flex h-8 items-center gap-2 text-base font-medium text-muted-foreground">
      <DotMatrixSpinner />
      <ShimmerText>Working</ShimmerText>
    </div>
  );
}

function TranscriptWorkingLiveRegion({ active }: { active: boolean }): React.JSX.Element {
  return (
    <output aria-live="polite" className="sr-only">
      {active ? "Agent is working" : ""}
    </output>
  );
}

function TranscriptSearchMirror({ text }: { text: string }): React.JSX.Element | null {
  if (!text) {
    return null;
  }
  return (
    <pre aria-hidden="true" className="transcript-search-mirror">
      {text}
    </pre>
  );
}
