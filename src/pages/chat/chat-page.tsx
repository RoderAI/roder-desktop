import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, Folder, MessageSquare } from "lucide-react";
import { AgentWaitCards } from "@/components/agent-wait-card";
import { useAppShell } from "@/components/app-shell-context";
import { Composer } from "@/components/composer";
import { NativeCommandOutput } from "@/components/native-command-output";
import { NativeModelPicker } from "@/components/native-model-picker";
import { Transcript } from "@/components/transcript";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { threadSelectionForRoute } from "@/lib/route-selection";
import { threadTitle } from "@/lib/roder-thread";
import { normalizeWorkspacePath, normalizedTimestamp, type FolderOption } from "@/lib/workspace-thread-options";
import { mergedCommandDescriptors } from "@/lib/native-commands";
import { useCommandsStore } from "@/stores/commands-store";
import { skillsLoadContextKey, useSkillsStore } from "@/stores/skills-store";
import type { RoderThread, Workspace } from "@/types/roder";

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
    folderOptions,
    hunkSummary,
    openReview,
    setCanScrollTranscriptToBottom,
    setComposerAttachments,
    showWorkingIndicator,
    followBottom,
    selectNativeCommandModel,
    sendCommandInvocation,
    sendPrompt,
    steerPrompt,
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
  const composerQueueBusy = activeThreadBusy || agent.busy;
  const showNewAgentEmptyState = route === "new" && transcriptMessages.length === 0 && !showWorkingIndicator;
  const showScrollToBottom = showNewAgentEmptyState ? false : canScrollTranscriptToBottom;
  const composerGuardStyle = {
    height: composerStackHeight + (showScrollToBottom ? composerGuardFadeHeightPx : 0),
  };
  const openTurnChanges = (turnId: string) => {
    openReview("turn", turnId);
  };

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
      {showNewAgentEmptyState ? (
        <NewAgentEmptyState
          activeFolderPath={agent.selectedWorkspaceCwd}
          projects={projectOptionsForEmptyState(agent.workspaces, folderOptions, agent.selectedWorkspaceCwd)}
          recentThreads={recentThreadsForEmptyState(agent.threads)}
          composerBottomInsetPx={transcriptBottomInsetPx}
          onSelectFolder={(path) => {
            agent.stageNewThread(path);
          }}
          onSelectThread={(selectedThreadId) => {
            void navigate({ to: "/threads/$threadId", params: { threadId: selectedThreadId }, search: true });
            void agent.selectThread(selectedThreadId, { pushHistory: false });
          }}
        />
      ) : (
        <Transcript
          activeTurnId={agent.activeTurnId}
          messages={transcriptMessages}
          followSignal={followSignal}
          bottomInsetPx={transcriptBottomInsetPx}
          scrollStateKey={activeThreadId || "new-thread"}
          showWorkingIndicator={showWorkingIndicator}
          turnChangeSummaries={hunkSummary.turnChangeSummaries}
          onCanScrollToBottomChange={setCanScrollTranscriptToBottom}
          onReviewTurnChanges={openTurnChanges}
        />
      )}
      <div className="pointer-events-none absolute bottom-0 left-0 right-2 z-10">
        <div
          className="chat-composer-guard"
          data-fade={showScrollToBottom ? "true" : undefined}
          style={composerGuardStyle}
        />
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
            <div className="mx-auto mb-3 w-full max-w-3xl px-5 text-base text-destructive">{agent.error}</div>
          )}
          <Composer
            activeThreadId={activeThreadId}
            busy={activeThreadBusy}
            queueBusy={composerQueueBusy}
            commands={mergedCommands}
            models={agent.models}
            routingOptions={agent.routingOptions}
            skills={skills}
            selectedModel={agent.selectedModel}
            selectedModelProvider={agent.selectedModelProvider}
            selectedSelectionMode={agent.selectedSelectionMode}
            selectedPolicyMode={agent.selectedPolicyMode}
            selectedReasoning={agent.selectedReasoning}
            attachments={composerAttachments}
            queuedPrompts={agent.queuedPrompts}
            focusSignal={composerFocusSignal}
            showScrollToBottom={showScrollToBottom}
            onSelectedModelChange={(model, provider) => void agent.setSelectedModel(model, provider)}
            onSelectedAutoModelChange={(optionId) => void agent.setSelectedAutoModel(optionId)}
            onSelectedPolicyModeChange={(mode) => void agent.setSelectedPolicyMode(mode)}
            onSelectedReasoningChange={agent.setSelectedReasoning}
            onScrollToBottom={followBottom}
            onAttachmentsChange={setComposerAttachments}
            onQueuePrompt={agent.addQueuedPrompt}
            onRemoveQueuedPrompt={agent.removeQueuedPrompt}
            onCommandSubmit={sendCommandInvocation}
            onSend={sendPrompt}
            onSteer={steerPrompt}
            onStop={agent.stopTurn}
          />
        </div>
      </div>
    </div>
  );
}

function NewAgentEmptyState({
  activeFolderPath,
  projects,
  recentThreads,
  composerBottomInsetPx,
  onSelectFolder,
  onSelectThread,
}: {
  activeFolderPath: string;
  projects: ProjectOption[];
  recentThreads: RoderThread[];
  composerBottomInsetPx: number;
  onSelectFolder: (path: string) => void;
  onSelectThread: (threadId: string) => void;
}): React.JSX.Element {
  const activeFolderKey = normalizeWorkspacePath(activeFolderPath);
  const activeProject = projects.find((project) => normalizeWorkspacePath(project.path) === activeFolderKey);
  const activeProjectLabel = activeProject?.name ?? folderLabel(activeFolderPath);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-8" style={{ paddingBottom: composerBottomInsetPx }}>
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center py-8 text-center">
        <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground">
          <MessageSquare className="size-5" />
        </div>
        <h2 className="text-base font-semibold text-foreground">Start a new agent</h2>
        <p className="mt-2 max-w-md text-base font-normal leading-6 text-muted-foreground">
          Pick a project, then tell Roder what you want to build, fix, or explore.
        </p>
        <div className="mt-5">
          <ProjectPicker
            projects={projects}
            activeFolderPath={activeFolderPath}
            activeFolderLabel={activeProjectLabel}
            onSelectFolder={onSelectFolder}
          />
        </div>
        <RecentThreads threads={recentThreads} onSelectThread={onSelectThread} />
      </div>
    </div>
  );
}

function ProjectPicker({
  projects,
  activeFolderPath,
  activeFolderLabel,
  onSelectFolder,
}: {
  projects: ProjectOption[];
  activeFolderPath: string;
  activeFolderLabel: string;
  onSelectFolder: (path: string) => void;
}): React.JSX.Element {
  const activeFolderKey = normalizeWorkspacePath(activeFolderPath);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        variant="pill"
        className="h-9 max-w-[320px] bg-card px-3 text-base shadow-sm ring-1 ring-border/70 hover:bg-card"
        aria-label={`Choose project: ${activeFolderLabel}`}
        title={activeFolderPath}
      >
        <Folder className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{activeFolderLabel}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" side="bottom" sideOffset={8} className="w-[340px] rounded-xl p-1.5">
        <DropdownMenuGroup className="max-h-[300px] overflow-y-auto">
          <div className="px-2 pb-1 pt-1 text-base font-medium text-muted-foreground">Projects</div>
          {projects.length > 0 ? (
            projects.map((project) => {
              const selected = normalizeWorkspacePath(project.path) === activeFolderKey;
              return (
                <DropdownMenuItem
                  key={project.path}
                  selected={selected}
                  className="h-10 rounded-lg px-2 text-base"
                  onSelect={() => onSelectFolder(project.path)}
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{project.name}</span>
                  <span className="shrink-0 text-base text-muted-foreground">{threadCountLabel(project.threadCount)}</span>
                  {selected && <Check className="size-3.5 shrink-0 text-primary" />}
                </DropdownMenuItem>
              );
            })
          ) : (
            <div className="px-2 py-4 text-base text-muted-foreground">No projects yet</div>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RecentThreads({
  threads,
  onSelectThread,
}: {
  threads: RoderThread[];
  onSelectThread: (threadId: string) => void;
}): React.JSX.Element {
  return (
    <section className="mt-8 w-full max-w-xl text-left" aria-labelledby="new-agent-recent-threads-heading">
      <h3 id="new-agent-recent-threads-heading" className="text-base font-semibold text-foreground">
        Recent threads
      </h3>
      <p className="mt-1 text-sm font-normal text-muted-foreground">Jump back into your last work.</p>
      <div className="mt-3 flex flex-col gap-1.5">
        {threads.length > 0 ? (
          threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none transition-colors",
                "hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
              )}
              onClick={() => void onSelectThread(thread.id)}
            >
              <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium text-foreground">{threadTitle(thread)}</span>
                <span className="block truncate text-sm font-normal text-muted-foreground">{folderLabel(thread.cwd)}</span>
              </span>
              <span className="shrink-0 text-sm font-normal text-muted-foreground">{relativeAge(thread.updatedAt)}</span>
              <ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground/70" aria-hidden="true" />
            </button>
          ))
        ) : (
          <div className="rounded-xl bg-muted/30 px-3 py-3 text-base font-normal text-muted-foreground">
            No recent threads yet.
          </div>
        )}
      </div>
    </section>
  );
}

function recentThreadsForEmptyState(threads: RoderThread[]): RoderThread[] {
  return threads
    .filter((thread) => !thread.id.startsWith("demo-"))
    .toSorted((left, right) => normalizedTimestamp(right.updatedAt) - normalizedTimestamp(left.updatedAt))
    .slice(0, 3);
}

type ProjectOption = {
  path: string;
  name: string;
  updatedAt: number;
  threadCount: number;
};

function projectOptionsForEmptyState(
  workspaces: Workspace[],
  folders: FolderOption[],
  activeFolderPath: string,
): ProjectOption[] {
  const projectsByPath = new Map<string, ProjectOption>();
  for (const folder of folders) {
    const key = normalizeWorkspacePath(folder.path);
    if (!key) {
      continue;
    }
    projectsByPath.set(key, { ...folder, path: key });
  }

  for (const workspace of workspaces) {
    for (const root of workspace.roots) {
      const path = normalizeWorkspacePath(root.path);
      if (!path || projectsByPath.has(path)) {
        continue;
      }
      projectsByPath.set(path, {
        path,
        name: root.name || workspace.name || folderLabel(path),
        updatedAt: normalizedTimestamp(workspace.updatedAt),
        threadCount: 0,
      });
    }
  }

  const activeFolderKey = normalizeWorkspacePath(activeFolderPath);
  return Array.from(projectsByPath.values()).toSorted((left, right) => {
    if (normalizeWorkspacePath(left.path) === activeFolderKey) {
      return -1;
    }
    if (normalizeWorkspacePath(right.path) === activeFolderKey) {
      return 1;
    }
    return right.updatedAt - left.updatedAt || left.name.localeCompare(right.name);
  });
}

function folderLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || "Select project";
}

function threadCountLabel(count: number): string {
  return count === 1 ? "1 thread" : `${count} threads`;
}

function relativeAge(timestamp: number): string {
  const normalized = normalizedTimestamp(timestamp);
  if (normalized <= 0) {
    return "";
  }
  const diffMs = Math.max(0, Date.now() - normalized);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) {
    return `${Math.max(1, Math.floor(diffMs / minute))}m`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h`;
  }
  return `${Math.floor(diffMs / day)}d`;
}
