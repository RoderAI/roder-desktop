import { Laptop, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
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
import type { DesktopAttachment } from "@/types/gode";

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
  const projectName = basename(activeThread?.cwd ?? agent.selectedWorkspaceCwd ?? agent.threads.find((thread) => thread.cwd)?.cwd) ?? "workspace";
  const followBottom = useCallback(() => setFollowSignal((value) => value + 1), []);
  const selectThread = useCallback(
    (threadId: string) => {
      followBottom();
      void agent.selectThread(threadId);
    },
    [agent, followBottom],
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
          status={agent.status}
          activeTool={activeTool}
          sidebarOpen={sidebarOpen}
          onRestart={() => void agent.restart()}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
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
