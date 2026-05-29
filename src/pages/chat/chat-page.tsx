import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AgentWaitCards } from "@/components/agent-wait-card";
import { useAppShell } from "@/components/app-shell-context";
import { Composer } from "@/components/composer";
import { Transcript } from "@/components/transcript";
import { threadSelectionForRoute } from "@/lib/route-selection";
import { useSkillsStore } from "@/stores/skills-store";

export function ChatPage({ route, threadId }: { route: "new" | "thread"; threadId?: string }): React.JSX.Element {
  const shell = useAppShell();
  const navigate = useNavigate();
  const {
    agent,
    activeThreadBusy,
    canScrollTranscriptToBottom,
    composerAttachments,
    composerFocusSignal,
    followSignal,
    setCanScrollTranscriptToBottom,
    setComposerAttachments,
    showWorkingIndicator,
    followBottom,
    sendPrompt,
  } = shell;
  const skills = useSkillsStore((state) => state.skills);
  const { activeThreadId, selectThread } = agent;
  const newRouteReadyForCreatedThreadRef = useRef(false);
  const clearingActiveThreadForNewRouteRef = useRef(false);

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
    <>
      <Transcript
        activeTurnId={agent.activeTurnId}
        messages={agent.messages}
        followSignal={followSignal}
        showWorkingIndicator={showWorkingIndicator}
        onCanScrollToBottomChange={setCanScrollTranscriptToBottom}
      />
      <AgentWaitCards
        requests={agent.waitRequests}
        onResolveApproval={agent.resolveApproval}
        onResolveUserInput={agent.resolveUserInput}
        onExitPlan={agent.exitPlan}
      />
      {agent.error && (
        <div className="mx-auto mb-3 w-full max-w-[980px] px-8 text-base text-destructive">{agent.error}</div>
      )}
      <Composer
        busy={activeThreadBusy}
        models={agent.models}
        skills={skills}
        selectedModel={agent.selectedModel}
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
        onSend={sendPrompt}
        onStop={agent.stopTurn}
      />
    </>
  );
}
