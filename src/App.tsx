import { Laptop, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { BrowserPanel } from "@/components/browser-panel";
import { CanvasPanel } from "@/components/canvas-panel";
import { Composer } from "@/components/composer";
import { SettingsView } from "@/components/settings-view";
import { TerminalPanel } from "@/components/terminal-panel";
import { TopBar, type ToolPanel } from "@/components/top-bar";
import { Transcript } from "@/components/transcript";
import { Badge } from "@/components/ui/badge";
import { useGodeAgent } from "@/hooks/use-gode-agent";
import { useThemeApplication } from "@/hooks/use-theme-application";
import { useThemeStore } from "@/stores/theme-store";
import type { DesktopAttachment, GodeThread } from "@/types/gode";

export function App(): React.JSX.Element {
  const agent = useGodeAgent();
  const settingsOpen = useThemeStore((state) => state.settingsOpen);
  useThemeApplication(agent.appearance);
  const [followSignal, setFollowSignal] = useState(0);
  const [activeTool, setActiveTool] = useState<ToolPanel>(null);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(274);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolPanelWidth, setToolPanelWidth] = useState(560);
  const [composerAttachments, setComposerAttachments] = useState<DesktopAttachment[]>([]);
  const activeThread = agent.threads.find((thread) => thread.id === agent.activeThreadId);
  const activeWorkspaceCwd = activeThread?.cwd ?? agent.selectedWorkspaceCwd ?? agent.status.cwd ?? "";
  const folderOptions = useMemo(() => buildFolderOptions(agent.threads, activeWorkspaceCwd), [activeWorkspaceCwd, agent.threads]);
  const threadOptions = useMemo(() => {
    const selectedFolder = normalizePath(activeWorkspaceCwd);
    return agent.threads
      .filter((thread) => !thread.id.startsWith("demo-") && normalizePath(thread.cwd) === selectedFolder)
      .sort((left, right) => normalizedTimestamp(right.updatedAt) - normalizedTimestamp(left.updatedAt));
  }, [activeWorkspaceCwd, agent.threads]);
  const projectName = basename(activeThread?.cwd ?? agent.selectedWorkspaceCwd ?? agent.threads.find((thread) => thread.cwd)?.cwd) ?? "workspace";
  const followBottom = useCallback(() => setFollowSignal((value) => value + 1), []);
  const selectThread = useCallback(
    (threadId: string) => {
      followBottom();
      void agent.selectThread(threadId);
    },
    [agent, followBottom],
  );
  const selectFolder = useCallback(
    (path: string) => {
      const normalizedPath = normalizePath(path);
      const latestThread = agent.threads
        .filter((thread) => !thread.id.startsWith("demo-") && normalizePath(thread.cwd) === normalizedPath)
        .sort((left, right) => normalizedTimestamp(right.updatedAt) - normalizedTimestamp(left.updatedAt))[0];

      agent.setSelectedWorkspaceCwd(path);
      if (latestThread) {
        selectThread(latestThread.id);
      }
    },
    [agent, selectThread],
  );
  const newThread = useCallback(() => {
    followBottom();
    void agent.newThread();
  }, [agent, followBottom]);
  const attachToComposer = useCallback(
    (attachment: DesktopAttachment) => {
      setComposerAttachments((attachments) =>
        attachments.some((existing) => existing.path === attachment.path) ? attachments : [...attachments, attachment],
      );
      followBottom();
    },
    [followBottom],
  );
  const sendPrompt = useCallback(
    async (prompt: string, attachments: DesktopAttachment[]) => {
      followBottom();
      await agent.sendPrompt(prompt, attachments);
    },
    [agent, followBottom],
  );
  const beginSidebarResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    beginHorizontalResize(event, leftSidebarWidth, (startWidth, deltaX) => {
      setLeftSidebarWidth(clamp(startWidth + deltaX, 220, 420));
    });
  }, [leftSidebarWidth]);
  const beginToolPanelResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    beginHorizontalResize(event, toolPanelWidth, (startWidth, deltaX) => {
      setToolPanelWidth(clamp(startWidth - deltaX, 360, 820));
    });
  }, [toolPanelWidth]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {settingsOpen && <SettingsView />}
      {sidebarOpen && (
        <>
          <AppSidebar
            threads={agent.threads}
            activeThreadId={agent.activeThreadId}
            width={leftSidebarWidth}
            onSelectThread={selectThread}
            onNewThread={newThread}
            onBack={() => void agent.goBack()}
            onForward={() => void agent.goForward()}
            canGoBack={agent.canGoBack}
            canGoForward={agent.canGoForward}
            onClose={() => setSidebarOpen(false)}
          />
          <div
            className="no-drag relative z-30 h-screen w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-border"
            aria-label="Resize thread sidebar"
            role="separator"
            onPointerDown={beginSidebarResize}
          />
        </>
      )}
      <section className="flex min-w-0 flex-1 flex-col">
        <TopBar
          thread={activeThread}
          threads={threadOptions}
          folders={folderOptions}
          activeFolderPath={activeWorkspaceCwd}
          status={agent.status}
          activeTool={activeTool}
          sidebarOpen={sidebarOpen}
          onRestart={() => void agent.restart()}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onSelectFolder={selectFolder}
          onSelectThread={selectThread}
          onToggleTerminal={() => setActiveTool((tool) => (tool === "terminal" ? null : "terminal"))}
          onToggleBrowser={() => setActiveTool((tool) => (tool === "browser" ? null : "browser"))}
          onToggleCanvas={() => setActiveTool((tool) => (tool === "canvas" ? null : "canvas"))}
        />
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <Transcript messages={agent.messages} followSignal={followSignal} />
            {agent.error && (
              <div className="mx-auto mb-3 w-full max-w-[980px] px-8 text-sm text-destructive">{agent.error}</div>
            )}
            <Composer
              busy={agent.busy}
              models={agent.models}
              selectedModel={agent.selectedModel}
              selectedReasoning={agent.selectedReasoning}
              selectedWorkspaceCwd={agent.selectedWorkspaceCwd}
              statusCwd={agent.status.cwd}
              workspaceRecents={agent.workspaceRecents}
              threads={agent.threads}
              attachments={composerAttachments}
              onSelectedModelChange={agent.setSelectedModel}
              onCycleReasoning={agent.cycleSelectedReasoning}
              onWorkspaceSelect={agent.setSelectedWorkspaceCwd}
              onOpenWorkspaceFolder={() => void agent.openWorkspaceFolder()}
              onScrollToBottom={followBottom}
              onAttachmentsChange={setComposerAttachments}
              onSend={sendPrompt}
            />
            <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border px-8 text-xs text-muted-foreground">
              <Laptop className="size-4" />
              <span>Local</span>
              <span>{projectName}</span>
              <span className="ml-auto flex items-center gap-2">
                {agent.busy && <Loader2 className="size-3 animate-spin" />}
                <Badge variant="muted" className="text-[11px]">
                  {agent.status.state === "ready" ? "gode app-server" : agent.status.state}
                </Badge>
              </span>
            </footer>
          </div>
          {activeTool && (
            <div className="relative h-full min-w-0 shrink-0" style={{ width: toolPanelWidth }}>
              <div
                className="no-drag absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize bg-transparent hover:bg-border"
                aria-label="Resize tool panel"
                role="separator"
                onPointerDown={beginToolPanelResize}
              />
              {activeTool === "terminal" && <TerminalPanel />}
              {activeTool === "browser" && <BrowserPanel onAttach={attachToComposer} />}
              {activeTool === "canvas" && <CanvasPanel onAttach={attachToComposer} />}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function basename(path: string | undefined): string | undefined {
  return path?.split("/").filter(Boolean).pop();
}

type FolderOption = {
  path: string;
  name: string;
  updatedAt: number;
  threadCount: number;
};

function buildFolderOptions(threads: GodeThread[], activePath: string): FolderOption[] {
  const folders = new Map<string, FolderOption>();
  const activeFolderPath = normalizePath(activePath);

  if (activeFolderPath) {
    folders.set(activeFolderPath, {
      path: activeFolderPath,
      name: workspaceName(activeFolderPath),
      updatedAt: Date.now(),
      threadCount: 0,
    });
  }

  for (const thread of threads) {
    if (thread.id.startsWith("demo-")) {
      continue;
    }
    const path = normalizePath(thread.cwd);
    const existing = folders.get(path);
    folders.set(path, {
      path,
      name: existing?.name ?? workspaceName(path),
      updatedAt: Math.max(existing?.updatedAt ?? 0, normalizedTimestamp(thread.updatedAt)),
      threadCount: (existing?.threadCount ?? 0) + 1,
    });
  }

  return [...folders.values()].sort((left, right) => {
    if (left.path === activeFolderPath) {
      return -1;
    }
    if (right.path === activeFolderPath) {
      return 1;
    }
    return right.updatedAt - left.updatedAt || left.name.localeCompare(right.name);
  });
}

function normalizePath(path: string | undefined): string {
  return (path || "").replace(/\/+$/, "") || path || "";
}

function workspaceName(path: string): string {
  return basename(path) ?? "workspace";
}

function normalizedTimestamp(timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function beginHorizontalResize(
  event: React.PointerEvent<HTMLDivElement>,
  startWidth: number,
  update: (startWidth: number, deltaX: number) => void,
): void {
  event.preventDefault();
  const startX = event.clientX;

  function onPointerMove(moveEvent: PointerEvent): void {
    update(startWidth, moveEvent.clientX - startX);
  }

  function onPointerUp(): void {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
