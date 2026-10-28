import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type WheelEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { TranscriptHistoryIndex } from "@/components/indexed-transcript";
import { sparseHistorySegments } from "@/lib/sparse-transcript-history";
import { messagesFromThread } from "@/lib/roder-thread";
import { FileDiff } from "lucide-react";
import { TranscriptNavigation } from "@/components/transcript-navigation";
import {
  activeTranscriptNavigationId,
  buildTranscriptNavigation,
  transcriptNavigationTarget,
} from "@/lib/transcript-navigation";
import type { ConversationMessage, SkillDescriptor, SubagentLifecycleEvent } from "@/types/roder";
import { reviewTurnChangeLabel, type ReviewTurnChangeSummary } from "@/lib/review-changes";
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
  buildTranscriptHistoryRows,
  reconcileTranscriptRows,
  transcriptNestedDisclosureKey,
  transcriptRowDisclosureKeys,
  transcriptRowsSearchText,
  type TranscriptEntryRow,
  type TranscriptRow,
} from "@/lib/transcript-rows";
import { CompactToolGroup } from "./compact-tool-group";
import { MessageContent } from "./message-content";
import { PhaseMessage } from "./phase-message";
import { SubagentLifecycleChip } from "./subagent-lifecycle-chip";
import { SubagentMessageCard } from "./subagent-message-card";
import { subagentMessagesForMessage } from "@/lib/subagent-messages";
import { ToolActivityGroup } from "./tool-activity-group";
import { ToolTimelineItem } from "./tool-timeline-item";
import { ShimmerText } from "./tool-timeline-shared";
import { UserMessageContent } from "@/components/user-message-content";
import { useSkillsStore } from "@/stores/skills-store";
import {
  captureHistoryScrollAnchor,
  restoreHistoryScrollAnchor,
  shouldLoadOlderHistory,
  nestedScrollConsumesUpwardGesture,
  type HistoryScrollAnchor,
} from "@/lib/transcript-history";

export type TranscriptProps = {
  messages: ConversationMessage[];
  followSignal: number;
  bottomInsetPx?: number;
  activeTurnId?: string;
  scrollStateKey?: string;
  showWorkingIndicator?: boolean;
  subagentLifecycleEvents?: readonly SubagentLifecycleEvent[];
  turnChangeSummaries?: Record<string, ReviewTurnChangeSummary>;
  onCanScrollToBottomChange?: (canScrollToBottom: boolean) => void;
  onReviewTurnChanges?: (turnId: string) => void;
  historyCursor?: string | null;
  historyLoading?: boolean;
  hasOlderHistory?: boolean;
  loadingOlderHistory?: boolean;
  historyError?: string | null;
  onLoadOlderHistory?: () => Promise<void>;
  onRetryHistory?: () => Promise<void>;
  navigationThreadId?: string;
  onLoadNavigationMessage?: (id: string, isCancelled: () => boolean, signal: AbortSignal) => Promise<void>;
  indexedHistory?: TranscriptHistoryIndex;
};

const emptySubagentLifecycleEvents: SubagentLifecycleEvent[] = [];

const defaultTranscriptScrollStateKey = "default";
const emptyTurnChangeSummaries: Record<string, ReviewTurnChangeSummary> = {};
const transcriptScrollStateByKey = new Map<string, TranscriptScrollRestorationState>();

function indexedTranscriptLayout(history?: TranscriptHistoryIndex): { rows: TranscriptRow[]; overscan: number } {
  if (!history) return { rows: [], overscan: 8 };
  return {
    rows: buildTranscriptHistoryRows(history.index.olderCount, history.estimatedItemSize),
    overscan: 1,
  };
}

export function Transcript({
  activeTurnId,
  bottomInsetPx = 0,
  messages,
  followSignal,
  scrollStateKey = defaultTranscriptScrollStateKey,
  showWorkingIndicator = false,
  subagentLifecycleEvents = emptySubagentLifecycleEvents,
  turnChangeSummaries = emptyTurnChangeSummaries,
  onCanScrollToBottomChange,
  onReviewTurnChanges,
  historyCursor = null,
  historyLoading = false,
  hasOlderHistory = false,
  loadingOlderHistory = false,
  historyError,
  onLoadOlderHistory,
  onRetryHistory,
  navigationThreadId,
  onLoadNavigationMessage,
  indexedHistory,
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
  const historyAnchorRef = useRef<(HistoryScrollAnchor & { threadKey: string; cursor: string | null }) | null>(null);
  const pendingNavigationRef = useRef<{ threadKey: string; id: string; controller: AbortController } | null>(null);
  const [disclosureOpenByKey, setDisclosureOpenByKey] = useState<TranscriptDisclosureState>({});
  const [pinnedToEnd, setPinnedToEnd] = useState(true);
  const [selectedNavigation, setSelectedNavigation] = useState<{ threadKey: string; id: string } | null>(null);
  const [navigationError, setNavigationError] = useState<{ threadKey: string; message: string } | null>(null);

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
  const previousTranscriptRowsRef = useRef<TranscriptRow[]>([]);
  const { rows: indexedRows, overscan } = useMemo(() => indexedTranscriptLayout(indexedHistory), [indexedHistory]);
  const transcriptRows = useMemo(() => {
    const rows = reconcileTranscriptRows(previousTranscriptRowsRef.current, [
      ...indexedRows,
      ...buildTranscriptRows({
        activeTurnId,
        messages,
        showWorkingIndicator,
        subagentLifecycleEvents,
        turnChangeSummaries: onReviewTurnChanges ? turnChangeSummaries : {},
      }),
    ]);
    previousTranscriptRowsRef.current = rows;
    return rows;
  }, [
    activeTurnId,
    messages,
    onReviewTurnChanges,
    showWorkingIndicator,
    subagentLifecycleEvents,
    turnChangeSummaries,
    indexedRows,
  ]);
  const transcriptRowKeys = useMemo(() => transcriptRows.map((row) => row.key), [transcriptRows]);
  const rowKeyVersion = useMemo(() => transcriptRowKeys.join("\u0000"), [transcriptRowKeys]);
  const transcriptVersion = useMemo(() => [messageVersion, rowKeyVersion].join("\n"), [messageVersion, rowKeyVersion]);
  const transcriptHasActiveStreaming = useMemo(() => {
    if (showWorkingIndicator) {
      return true;
    }
    // Scan from the end: active streams live at the tail, so this exits in O(1)
    // on the per-delta hot path.
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.status === "streaming" || message.toolStatus === "running") {
        return true;
      }
    }
    return false;
  }, [messages, showWorkingIndicator]);
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
    // Initial measurement happens before restoration. Do not replace the saved
    // position with the temporary top-of-list viewport during that measurement.
    if (restoredScrollStateKeyRef.current !== key) return;
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
    if (transcriptScrollStateByKey.size > 40) {
      const oldest = transcriptScrollStateByKey.keys().next().value;
      if (oldest) transcriptScrollStateByKey.delete(oldest);
    }
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
    // A history slot is a bounded page, not one message. Avoid fetching eight pages
    // on either side of the viewport merely because the live tail uses that overscan.
    overscan,
    paddingEnd: bottomInsetPx,
    paddingStart: hasOlderHistory || historyLoading || historyError ? 40 : 0,
    scrollEndThreshold: transcriptScrollAffordanceThresholdPx,
  });

  // Shared by virtualizer/DOM scroll callbacks, so keep this handler's identity stable.
  const loadOlderHistory = useCallback((): void => {
    if (!onLoadOlderHistory || loadingOlderHistory || historyLoading) return;
    const viewport = viewportRef.current;
    if (viewport) {
      historyAnchorRef.current = {
        ...captureHistoryScrollAnchor(
          rowVirtualizer.getVirtualItems(),
          viewport.scrollTop,
          rowVirtualizer.getTotalSize(),
        ),
        threadKey: scrollStateKey,
        cursor: historyCursor,
      };
      pinnedToEndRef.current = false;
      setPinnedToEnd(false);
    }
    void onLoadOlderHistory();
  }, [onLoadOlderHistory, loadingOlderHistory, historyLoading, rowVirtualizer, scrollStateKey, historyCursor]);

  const syncCanScrollToBottom = useCallback(() => {
    scrollObservationVersionRef.current += 1;
    const currentScrollTop = viewportRef.current?.scrollTop ?? 0;
    const userScrolledTowardStart = currentScrollTop < previousScrollTopRef.current - 1;
    const pendingAnchor = historyAnchorRef.current;
    if (pendingAnchor?.threadKey === scrollStateKey && pendingAnchor.cursor === historyCursor) {
      historyAnchorRef.current = {
        ...captureHistoryScrollAnchor(
          rowVirtualizer.getVirtualItems(),
          currentScrollTop,
          rowVirtualizer.getTotalSize(),
        ),
        threadKey: scrollStateKey,
        cursor: historyCursor,
      };
    }
    if (
      shouldLoadOlderHistory({
        hasMore: hasOlderHistory,
        loading: loadingOlderHistory || historyLoading,
        error: historyError,
        userIntent: userScrollIntentRef.current || !pinnedToEndRef.current,
        movingUp: userScrolledTowardStart,
        scrollTop: currentScrollTop,
      })
    ) {
      loadOlderHistory();
    }
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
  }, [
    rememberTranscriptScrollState,
    rowVirtualizer,
    syncTranscriptScrollState,
    hasOlderHistory,
    loadingOlderHistory,
    historyLoading,
    historyError,
    loadOlderHistory,
    historyCursor,
    scrollStateKey,
  ]);

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
  useLayoutEffect(() => {
    const anchor = historyAnchorRef.current;
    if (!anchor) return;
    if (anchor.threadKey !== scrollStateKey || historyError) {
      historyAnchorRef.current = null;
      return;
    }
    if (anchor.cursor === historyCursor) return;
    historyAnchorRef.current = null;
    if (pinnedToEndRef.current) return;
    const offset = restoreHistoryScrollAnchor(
      anchor,
      transcriptRows.map((row) => row.key),
      (index) => rowVirtualizer.getOffsetForIndex(index, "start")?.[0],
      rowVirtualizer.getTotalSize(),
    );
    setPinnedToEndState(false);
    scheduleScrollToOffset(offset);
  }, [
    historyCursor,
    historyError,
    scrollStateKey,
    transcriptRows,
    rowVirtualizer,
    scheduleScrollToOffset,
    setPinnedToEndState,
  ]);

  const setViewportNode = useCallback((viewport: HTMLDivElement | null) => {
    viewportRef.current = viewport;
  }, []);
  const markUserScrollIntent = useCallback(() => {
    pendingNavigationRef.current?.controller.abort();
    pendingNavigationRef.current = null;
    setSelectedNavigation(null);
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
      const viewport = viewportRef.current;
      if (
        viewport &&
        shouldLoadOlderHistory({
          hasMore: hasOlderHistory,
          loading: historyLoading || loadingOlderHistory,
          error: historyError,
          userIntent: true,
          movingUp: event.deltaY < 0,
          scrollTop: viewport.scrollTop,
        }) &&
        !nestedScrollConsumesUpwardGesture(event.target instanceof HTMLElement ? event.target : null, viewport)
      ) {
        loadOlderHistory();
      }
    },
    [markUserScrollIntent, hasOlderHistory, historyLoading, loadingOlderHistory, historyError, loadOlderHistory],
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
      const movingUp = event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home";
      const viewport = viewportRef.current;
      if (
        viewport &&
        shouldLoadOlderHistory({
          hasMore: hasOlderHistory,
          loading: historyLoading || loadingOlderHistory,
          error: historyError,
          userIntent: true,
          movingUp,
          scrollTop: viewport.scrollTop,
        }) &&
        !nestedScrollConsumesUpwardGesture(event.target instanceof HTMLElement ? event.target : null, viewport)
      ) {
        loadOlderHistory();
      }
    },
    [markUserScrollIntent, hasOlderHistory, historyLoading, loadingOlderHistory, historyError, loadOlderHistory],
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
    const key = scrollStateKeyRef.current;
    return () => {
      rememberTranscriptScrollState(key);
      if (pendingNavigationRef.current?.threadKey === key) {
        pendingNavigationRef.current.controller.abort();
        pendingNavigationRef.current = null;
      }
    };
  }, [rememberTranscriptScrollState, scrollStateKey]);

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
      pendingNavigationRef.current?.controller.abort();
      pendingNavigationRef.current = null;
      historyAnchorRef.current = null;
      setSelectedNavigation(null);
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
  // Key the memo on the mounted row keys (not virtualItems identity) so plain
  // scroll frames that keep the same rows mounted skip the rebuild entirely.
  const mountedRowKeysVersion = useMemo(
    () => virtualItems.map((virtualItem) => String(virtualItem.key)).join("\u0000"),
    [virtualItems],
  );
  const transcriptSearchText = useMemo(() => {
    const mountedRowKeys = new Set(mountedRowKeysVersion ? mountedRowKeysVersion.split("\u0000") : []);
    return transcriptRowsSearchText(transcriptRows, {
      excludedRowKeys: mountedRowKeys,
    });
  }, [mountedRowKeysVersion, transcriptRows]);
  const suppressAutoFollowScrollbar = transcriptHasActiveStreaming && pinnedToEnd;
  const navigationItems = buildTranscriptNavigation(transcriptRows);
  const selectedNavigationId = selectedNavigation?.threadKey === scrollStateKey ? selectedNavigation.id : null;
  const activeNavigationId =
    selectedNavigationId ??
    activeTranscriptNavigationId(navigationItems, rowVirtualizer.range?.startIndex ?? 0, pinnedToEnd);

  useLayoutEffect(() => {
    const pending = pendingNavigationRef.current;
    if (!pending || pending.threadKey !== scrollStateKey) return;
    const index = transcriptNavigationTarget(navigationItems, pending.id);
    if (index === null) return;
    pendingNavigationRef.current = null;
    rowVirtualizer.scrollToIndex(index, { align: "start", behavior: "auto" });
  }, [navigationItems, rowVirtualizer, scrollStateKey]);

  function jumpToMessage(id: string): void {
    const index = transcriptNavigationTarget(navigationItems, id);
    if (index === null && !onLoadNavigationMessage) return;
    cancelPendingScrollFrame();
    historyAnchorRef.current = null;
    scrollObservationVersionRef.current += 1;
    markUserScrollIntent();
    setSelectedNavigation({ threadKey: scrollStateKey, id });
    setPinnedToEndState(false);
    setNavigationError(null);
    if (index !== null) {
      pendingNavigationRef.current = null;
      rowVirtualizer.scrollToIndex(index, { align: "start", behavior: "auto" });
      return;
    }
    const pending = { threadKey: scrollStateKey, id, controller: new AbortController() };
    pendingNavigationRef.current = pending;
    const isCancelled = () =>
      pendingNavigationRef.current !== pending || scrollStateKeyRef.current !== pending.threadKey;
    void onLoadNavigationMessage?.(id, isCancelled, pending.controller.signal).catch((error: unknown) => {
      if (isCancelled()) return;
      pendingNavigationRef.current = null;
      setNavigationError({ threadKey: scrollStateKey, message: (error as Error).message });
    });
  }

  return (
    <div className="relative min-h-0 flex-1">
      <TranscriptSearchMirror text={transcriptSearchText} />
      <TranscriptWorkingLiveRegion active={showWorkingIndicator} />
      {navigationError?.threadKey === scrollStateKey && (
        <p role="alert" className="absolute left-8 top-2 z-30 rounded bg-popover px-3 py-2 text-sm">
          {navigationError.message}
        </p>
      )}
      <TranscriptHistoryControls
        hasMore={hasOlderHistory}
        loading={historyLoading}
        loadingOlder={loadingOlderHistory}
        error={historyError}
        onLoad={loadOlderHistory}
        onRetry={onRetryHistory}
      />
      <TranscriptNavigation
        key={`${scrollStateKey}:${historyLoading ? "loading" : "ready"}`}
        items={navigationItems}
        messages={messages}
        activeId={activeNavigationId}
        bottomInsetPx={bottomInsetPx}
        onSelect={jumpToMessage}
        history={
          navigationThreadId && !historyLoading
            ? { threadId: navigationThreadId, before: hasOlderHistory ? historyCursor : null }
            : undefined
        }
      />
      <ScrollArea
        className={cn("h-full", navigationItems.length > 0 && "ml-8")}
        viewportClassName={cn(
          "workspace-scrollbar transcript-viewport",
          suppressAutoFollowScrollbar && "transcript-viewport-auto-following",
        )}
        viewportProps={{
          onKeyDownCapture: handleViewportKeyDownCapture,
          onPointerDownCapture: markUserScrollIntent,
          onTouchStartCapture: markUserScrollIntent,
          onWheelCapture: handleViewportWheelCapture,
        }}
        viewportRef={setViewportNode}
        onViewportScroll={syncCanScrollToBottom}
      >
        <main className="mx-auto w-full max-w-3xl px-4 pt-2">
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
                  <TranscriptVirtualContent
                    row={row}
                    indexedHistory={indexedHistory}
                    skills={skills}
                    viewportRef={viewportRef}
                    virtualSize={virtualItem.size}
                    onReviewTurnChanges={onReviewTurnChanges}
                    onReloadHistory={onRetryHistory}
                    disclosureOpenByKey={disclosureOpenByKey}
                    onDisclosureOpenChange={setDisclosureOpen}
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

function TranscriptHistoryControls({
  hasMore,
  loading,
  loadingOlder,
  error,
  onLoad,
  onRetry,
}: {
  hasMore: boolean;
  loading: boolean;
  loadingOlder: boolean;
  error?: string | null;
  onLoad: () => void;
  onRetry?: () => Promise<void>;
}): React.JSX.Element | null {
  if (!hasMore && !loading && !error) return null;
  const label = loading
    ? "Loading recent messages..."
    : loadingOlder
      ? "Loading older messages..."
      : "Load older messages";
  return (
    <div className="pointer-events-none absolute inset-x-10 top-1 z-10 flex justify-center">
      <div className="pointer-events-auto rounded-lg bg-background/95 px-2 py-1 text-sm text-muted-foreground">
        {error ? (
          <div role="alert" className="flex items-center gap-2">
            <span>{error}</span>
            <Button size="sm" variant="ghost" onClick={() => (hasMore ? onLoad() : void onRetry?.())}>
              Retry
            </Button>
            {hasMore && (
              <Button size="sm" variant="ghost" onClick={() => void onRetry?.()}>
                Reload recent
              </Button>
            )}
          </div>
        ) : (
          <Button size="sm" variant="ghost" disabled={loadingOlder || loading} onClick={onLoad}>
            {label}
          </Button>
        )}
      </div>
    </div>
  );
}

function TranscriptVirtualContent({
  row,
  indexedHistory,
  skills,
  viewportRef,
  virtualSize,
  onReviewTurnChanges,
  onReloadHistory,
  disclosureOpenByKey,
  onDisclosureOpenChange,
}: {
  row: TranscriptRow;
  indexedHistory?: TranscriptHistoryIndex;
  skills: SkillDescriptor[];
  viewportRef: React.RefObject<HTMLDivElement | null>;
  virtualSize: number;
  onReviewTurnChanges?: (turnId: string) => void;
  onReloadHistory?: () => Promise<void>;
  disclosureOpenByKey: TranscriptDisclosureState;
  onDisclosureOpenChange: (key: string, open: boolean) => void;
}): React.JSX.Element {
  if (row.kind === "history" && indexedHistory)
    return (
      <TranscriptHistoryBlock
        row={row}
        history={indexedHistory}
        skills={skills}
        viewportRef={viewportRef}
        placeholderItemSize={virtualSize / (row.end - row.start)}
        onReviewTurnChanges={onReviewTurnChanges}
        onReloadHistory={onReloadHistory}
      />
    );
  return (
    <TranscriptRowView
      row={row}
      skills={skills}
      disclosureOpenByKey={disclosureOpenByKey}
      onDisclosureOpenChange={onDisclosureOpenChange}
      onReviewTurnChanges={onReviewTurnChanges}
    />
  );
}

function TranscriptHistoryBlock({
  row,
  history,
  skills,
  viewportRef,
  placeholderItemSize,
  onReviewTurnChanges,
  onReloadHistory,
}: {
  row: Extract<TranscriptRow, { kind: "history" }>;
  history: TranscriptHistoryIndex;
  skills: SkillDescriptor[];
  viewportRef: React.RefObject<HTMLDivElement | null>;
  placeholderItemSize: number;
  onReviewTurnChanges?: (turnId: string) => void;
  onReloadHistory?: () => Promise<void>;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(history.cache.subscribe, history.cache.getSnapshot, history.cache.getSnapshot);
  useMountEffect(() => history.cache.retainRange(row.start, row.end));
  const [disclosures, setDisclosures] = useState<TranscriptDisclosureState>({});
  const onDisclosureOpenChange = useCallback((key: string, open: boolean) => {
    setDisclosures((previous) => setTranscriptDisclosureOpen(previous, key, open));
  }, []);
  const segments = sparseHistorySegments(row, snapshot.windows);
  return (
    <section aria-label={`Conversation entries ${row.start + 1} to ${row.end}`} data-history-start={row.start}>
      {segments.map((segment) =>
        segment.page ? (
          <HistoryPageRows
            key={`${segment.start}:${segment.end}`}
            thread={segment.page.thread}
            skills={skills}
            disclosures={disclosures}
            onDisclosureOpenChange={onDisclosureOpenChange}
            onReviewTurnChanges={onReviewTurnChanges}
          />
        ) : (
          <TranscriptHistoryGap
            key={`${segment.start}:${segment.end}`}
            start={segment.start}
            end={segment.end}
            history={history}
            viewportRef={viewportRef}
            error={snapshot.errors[`${segment.start}:${segment.end}`]}
            placeholderItemSize={placeholderItemSize}
            onReloadHistory={onReloadHistory}
          />
        ),
      )}
    </section>
  );
}

function HistoryPageRows({
  thread,
  skills,
  disclosures,
  onDisclosureOpenChange,
  onReviewTurnChanges,
}: {
  thread: import("@/types/roder").RoderThread;
  skills: SkillDescriptor[];
  disclosures: TranscriptDisclosureState;
  onDisclosureOpenChange: (key: string, open: boolean) => void;
  onReviewTurnChanges?: (turnId: string) => void;
}): React.JSX.Element {
  const rows = useMemo(() => buildTranscriptRows({ messages: messagesFromThread(thread) }), [thread]);
  return (
    <>
      {rows.map((row) => (
        <div key={row.key} className={transcriptRowSpacing(row)}>
          <TranscriptRowView
            row={row}
            skills={skills}
            disclosureOpenByKey={disclosures}
            onDisclosureOpenChange={onDisclosureOpenChange}
            onReviewTurnChanges={onReviewTurnChanges}
          />
        </div>
      ))}
    </>
  );
}

function TranscriptHistoryGap({
  start,
  end,
  history,
  viewportRef,
  error,
  placeholderItemSize,
  onReloadHistory,
}: {
  start: number;
  end: number;
  history: TranscriptHistoryIndex;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  error?: string;
  placeholderItemSize: number;
  onReloadHistory?: () => Promise<void>;
}): React.JSX.Element {
  const element = useRef<HTMLDivElement | null>(null);
  useMountEffect(() => {
    if (!element.current) return;
    let stopWatching: (() => void) | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          stopWatching ??= history.cache.watchRange(start, end);
        } else {
          stopWatching?.();
          stopWatching = undefined;
        }
      },
      { root: viewportRef.current, rootMargin: "400px" },
    );
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      stopWatching?.();
    };
  });
  return (
    <div
      ref={element}
      style={{ minHeight: (end - start) * placeholderItemSize }}
      className="flex items-center justify-center py-6 text-sm text-muted-foreground"
      aria-busy={!error}
    >
      {error ? (
        <div role="alert" className="max-w-sm text-center">
          <p>Could not load this section.</p>
          <Button variant="ghost" size="sm" onClick={() => history.cache.retry(start, end)}>
            Retry section
          </Button>
          {onReloadHistory ? (
            <Button variant="ghost" size="sm" onClick={() => void onReloadHistory()}>
              Reload history
            </Button>
          ) : null}
        </div>
      ) : (
        <span role="status">Loading this section…</span>
      )}
    </div>
  );
}

const TranscriptRowView = memo(function TranscriptRowView({
  disclosureOpenByKey,
  onDisclosureOpenChange,
  onReviewTurnChanges,
  row,
  skills,
}: {
  disclosureOpenByKey: TranscriptDisclosureState;
  onDisclosureOpenChange: (key: string, open: boolean) => void;
  onReviewTurnChanges?: (turnId: string) => void;
  row: TranscriptRow;
  skills: SkillDescriptor[];
}): React.JSX.Element | null {
  if (row.kind === "history") return null;
  if (row.kind === "turnReviewChanges") {
    if (!onReviewTurnChanges) {
      return null;
    }
    return <TurnChangesCard summary={row.summary} onReview={() => onReviewTurnChanges(row.turnId)} />;
  }

  if (row.kind === "working") {
    return <ThreadWorkingIndicator />;
  }

  if (row.kind === "subagentLifecycle") {
    return <SubagentLifecycleChip event={row.event} />;
  }

  return (
    <TranscriptEntryView
      disclosureOpenByKey={disclosureOpenByKey}
      onDisclosureOpenChange={onDisclosureOpenChange}
      row={row}
      skills={skills}
    />
  );
});

const TranscriptEntryView = memo(function TranscriptEntryView({
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
  const subagentMessages = subagentMessagesForMessage(message);
  const isPhaseMessage = message?.role === "assistant" && Boolean(message.phase && message.phase !== "final_answer");
  const getDisclosureControl = (key: string, defaultOpen = false) => ({
    onOpenChange: (open: boolean) => onDisclosureOpenChange(key, open),
    open: disclosureOpenByKey[key] ?? defaultOpen,
  });
  const rowDisclosureKey = row.disclosureKey;
  const disclosureControl = rowDisclosureKey
    ? getDisclosureControl(rowDisclosureKey, entry.kind === "activityGroup" && Boolean(entry.live))
    : {};
  const getEntryDisclosureControl =
    rowDisclosureKey && entry.kind === "activityGroup"
      ? (activityEntry: (typeof entry.entries)[number]) => {
          const nestedDisclosureKey = transcriptNestedDisclosureKey(rowDisclosureKey, activityEntry);
          return nestedDisclosureKey ? getDisclosureControl(nestedDisclosureKey) : {};
        }
      : undefined;

  return (
    <article
      className={cn(
        "text-foreground",
        message?.role === "user" && !subagentMessages && "rounded-[14px] bg-card px-4 py-3 text-base",
      )}
    >
      {entry.kind === "activityGroup" ? (
        <ToolActivityGroup
          entries={entry.entries}
          live={entry.live}
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
      ) : subagentMessages ? (
        <div className="space-y-2">
          {subagentMessages.map((delivery) => (
            <SubagentMessageCard
              key={delivery.id}
              message={delivery}
              skills={skills}
              {...getDisclosureControl(`${rowDisclosureKey}:subagent:${delivery.id}`)}
            />
          ))}
        </div>
      ) : message?.role === "tool" ? (
        <ToolTimelineItem message={message} {...disclosureControl} />
      ) : isPhaseMessage ? (
        <PhaseMessage
          isStreaming={message.status === "streaming"}
          phase={message.phase}
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
});

function transcriptRowSpacing(row: TranscriptRow): string {
  if (row.kind === "history") return "";
  if (row.kind === "turnReviewChanges") {
    return "py-3";
  }
  if (row.kind === "working" || row.kind === "subagentLifecycle") {
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

export function estimateTranscriptRowSize(row: TranscriptRow | undefined): number {
  if (!row) {
    return 72;
  }
  if (row.kind === "history") return row.estimatedSize;
  if (row.kind === "turnReviewChanges") {
    return 88;
  }
  if (row.kind === "working" || row.kind === "subagentLifecycle") {
    return 36;
  }
  if (row.entryIsTool) {
    return 36;
  }
  if (row.entry.kind === "message") {
    const deliveries = subagentMessagesForMessage(row.entry.message);
    if (deliveries) return deliveries.length * 164;
  }
  if (row.entry.kind === "message" && row.entry.message.role === "user") {
    return 72;
  }
  return 120;
}

function TurnChangesCard({
  summary,
  onReview,
}: {
  summary: ReviewTurnChangeSummary;
  onReview: () => void;
}): React.JSX.Element {
  const hasLineDelta = summary.additions > 0 || summary.deletions > 0;

  return (
    <section
      aria-label={reviewTurnChangeLabel(summary)}
      className="rounded-xl bg-card text-card-foreground ring-1 ring-border"
    >
      <div className="flex items-center gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/45 text-muted-foreground">
          <FileDiff className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{reviewTurnChangeLabel(summary)}</div>
          {hasLineDelta && <LineDelta additions={summary.additions} deletions={summary.deletions} />}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-10 rounded-lg bg-background px-4 text-foreground ring-1 ring-border hover:bg-accent hover:text-accent-foreground"
          onClick={onReview}
        >
          Review changes
        </Button>
      </div>
    </section>
  );
}

function LineDelta({ additions, deletions }: { additions: number; deletions: number }): React.JSX.Element {
  return (
    <div
      className="flex shrink-0 items-center gap-1.5 font-medium tabular-nums"
      aria-label={`${additions} additions, ${deletions} deletions`}
    >
      <span className="text-emerald-600">+{additions}</span>
      <span className="text-destructive">-{deletions}</span>
    </div>
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
