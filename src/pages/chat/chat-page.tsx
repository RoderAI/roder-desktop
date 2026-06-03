import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AgentWaitCards } from "@/components/agent-wait-card";
import { useAppShell } from "@/components/app-shell-context";
import { Composer } from "@/components/composer";
import { NativeCommandOutput } from "@/components/native-command-output";
import { NativeModelPicker } from "@/components/native-model-picker";
import { Transcript } from "@/components/transcript";
import { threadSelectionForRoute } from "@/lib/route-selection";
import { mergedCommandDescriptors } from "@/lib/native-commands";
import { useCommandsStore } from "@/stores/commands-store";
import { skillsLoadContextKey, useSkillsStore } from "@/stores/skills-store";

const transcriptComposerGapPx = 24;
const composerGuardFadeHeightPx = 88;
const initialComposerStackHeightPx = 160;

export function ChatPage({ route, threadId }: { route: "new" | "thread"; threadId?: string }): React.JSX.Element {
  const shell = useAppShell();
  const navigate = useNavigate();
  const {
    agent,
    activeThreadBusy,
    canScrollTranscriptToBottom,
    closeNativeModelPicker,
    composerAttachments,
    composerFocusSignal,
    nativeModelPickerOpen,
    nativeCommandOutput,
    followSignal,
    hunkSummary,
    openReview,
    setCanScrollTranscriptToBottom,
    setComposerAttachments,
    showWorkingIndicator,
    followBottom,
    selectNativeCommandModel,
    sendCommandInvocation,
    sendPrompt,
    localTranscriptOffset,
  } = shell;
  const commands = useCommandsStore((state) => state.commands);
  const mergedCommands = mergedCommandDescriptors(commands);
  const commandsLoaded = useCommandsStore((state) => state.loaded);
  const commandsLoading = useCommandsStore((state) => state.loading);
  const loadCommands = useCommandsStore((state) => state.load);
  const skills = useSkillsStore((state) => state.skills);
  const skillsLoaded = useSkillsStore((state) => state.loaded);
  const skillsLoadedContextKey = useSkillsStore((state) => state.loadedContextKey);
  const skillsLoading = useSkillsStore((state) => state.loading);
  const loadSkills = useSkillsStore((state) => state.load);
  const { activeThreadId, selectThread } = agent;
  const composerStackRef = useRef<HTMLDivElement | null>(null);
  const [composerStackHeight, setComposerStackHeight] = useState(initialComposerStackHeightPx);
  const newRouteReadyForCreatedThreadRef = useRef(false);
  const clearingActiveThreadForNewRouteRef = useRef(false);
  const transcriptBottomInsetPx = composerStackHeight + transcriptComposerGapPx;
  const transcriptMessages =
    localTranscriptOffset?.threadId === (activeThreadId || "new-thread")
      ? agent.messages.slice(localTranscriptOffset.hiddenMessageCount)
      : agent.messages;
  const composerGuardStyle = {
    height: composerStackHeight + (canScrollTranscriptToBottom ? composerGuardFadeHeightPx : 0),
  };
  const openThreadChanges = useCallback(() => {
    openReview("thread");
  }, [openReview]);
  const openTurnChanges = useCallback(
    (turnId: string) => {
      openReview("turn", turnId);
    },
    [openReview],
  );

  useEffect(() => {
    const skillsContext = {
      workspaceId: agent.selectedWorkspaceId,
      rootId: agent.selectedRootId,
      cwd: agent.selectedWorkspaceCwd,
    };
    const contextKey = skillsLoadContextKey(skillsContext);
    if (agent.status.state === "ready" && !skillsLoading && (!skillsLoaded || skillsLoadedContextKey !== contextKey)) {
      void loadSkills(skillsContext);
    }
  }, [
    agent.status.state,
    agent.selectedRootId,
    agent.selectedWorkspaceCwd,
    agent.selectedWorkspaceId,
    loadSkills,
    skillsLoaded,
    skillsLoadedContextKey,
    skillsLoading,
  ]);

  useEffect(() => {
    if (agent.status.state === "ready" && !commandsLoaded && !commandsLoading) {
      void loadCommands();
    }
  }, [agent.status.state, commandsLoaded, commandsLoading, loadCommands]);

  useLayoutEffect(() => {
    const node = composerStackRef.current;
    if (!node) {
      return;
    }

    const syncHeight = () => {
      setComposerStackHeight(Math.ceil(node.getBoundingClientRect().height));
    };
    const resizeObserver = new ResizeObserver(syncHeight);
    syncHeight();
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (route === "new") {
      if (!activeThreadId) {
        newRouteReadyForCreatedThreadRef.current = true;
        clearingActiveThreadForNewRouteRef.current = false;
        return;
      }
      if (!newRouteReadyForCreatedThreadRef.current && !clearingActiveThreadForNewRouteRef.current) {
        const selection = threadSelectionForRoute({ route, activeThreadId });
        if (selection) {
          clearingActiveThreadForNewRouteRef.current = true;
          void selectThread(selection.threadId, { pushHistory: selection.pushHistory });
        }
      }
      return;
    }
    newRouteReadyForCreatedThreadRef.current = false;
    clearingActiveThreadForNewRouteRef.current = false;
    const selection = threadSelectionForRoute({
      route,
      threadId: threadId ?? "",
      activeThreadId,
    });
    if (selection) {
      void selectThread(selection.threadId, { pushHistory: selection.pushHistory });
    }
  }, [activeThreadId, route, selectThread, threadId]);

  useEffect(() => {
    if (route === "new" && activeThreadId && newRouteReadyForCreatedThreadRef.current) {
      void navigate({
        to: "/threads/$threadId",
        params: { threadId: activeThreadId },
        replace: true,
        search: true,
      });
    }
  }, [activeThreadId, navigate, route]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Transcript
        activeTurnId={agent.activeTurnId}
        messages={transcriptMessages}
        followSignal={followSignal}
        bottomInsetPx={transcriptBottomInsetPx}
        scrollStateKey={activeThreadId || "new-thread"}
        showWorkingIndicator={showWorkingIndicator}
        threadChangeCount={hunkSummary.fileCount}
        turnChangeCounts={hunkSummary.turnChangeCounts}
        onCanScrollToBottomChange={setCanScrollTranscriptToBottom}
        onReviewThreadChanges={openThreadChanges}
        onReviewTurnChanges={openTurnChanges}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className="mx-auto w-full max-w-3xl px-8">
          <div
            className="chat-composer-guard"
            data-fade={canScrollTranscriptToBottom ? "true" : undefined}
            style={composerGuardStyle}
          />
        </div>
      </div>
      <div ref={composerStackRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
        <div className="pointer-events-auto relative">
          <AgentWaitCards
            requests={agent.waitRequests}
            onResolveApproval={agent.resolveApproval}
            onResolveUserInput={agent.resolveUserInput}
            onExitPlan={agent.exitPlan}
          />
          {nativeModelPickerOpen && (
            <NativeModelPicker
              models={agent.models}
              selectedModel={agent.selectedModel}
              selectedModelProvider={agent.selectedModelProvider}
              onDismiss={closeNativeModelPicker}
              onSelect={selectNativeCommandModel}
            />
          )}
          <NativeCommandOutput output={nativeCommandOutput} />
          {agent.error && (
            <div className="mx-auto mb-3 w-full max-w-3xl px-8 text-base text-destructive">{agent.error}</div>
          )}
          <Composer
            busy={activeThreadBusy}
            commands={mergedCommands}
            models={agent.models}
            skills={skills}
            selectedModel={agent.selectedModel}
            selectedModelProvider={agent.selectedModelProvider}
            selectedPolicyMode={agent.selectedPolicyMode}
            selectedReasoning={agent.selectedReasoning}
            attachments={composerAttachments}
            focusSignal={composerFocusSignal}
            showScrollToBottom={canScrollTranscriptToBottom}
            onSelectedModelChange={agent.setSelectedModel}
            onSelectedPolicyModeChange={(mode) => void agent.setSelectedPolicyMode(mode)}
            onSelectedReasoningChange={agent.setSelectedReasoning}
            onScrollToBottom={followBottom}
            onAttachmentsChange={setComposerAttachments}
            onCommandSubmit={sendCommandInvocation}
            onSend={sendPrompt}
            onStop={agent.stopTurn}
          />
        </div>
      </div>
    </div>
  );
}
