import { AlertCircle, ArrowLeft, ArrowRight, Clock3, HelpCircle, Loader2, PanelLeft, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserPanel } from "@/components/browser-panel";
import { CanvasPanel } from "@/components/canvas-panel";
import { SettingsView } from "@/components/settings-view";
import { TeamShell } from "@/components/team-shell";
import { TerminalPanel } from "@/components/terminal-panel";
import { Badge } from "@/components/ui/badge";
import { godeIpc } from "@/lib/gode-ipc";
import {
  toTeamShellMembers,
  toTeamShellMessages,
  toTeamShellTeam,
  type TeamAppId,
} from "@/lib/team-view-model";
import { useRoderTeam } from "@/hooks/use-roder-team";
import { recordDebugEvent, useDebugEventStore } from "@/stores/debug-event-store";
import { useThemeApplication } from "@/hooks/use-theme-application";
import { useThemeStore } from "@/stores/theme-store";
import type { TeamDrawer } from "@/components/team-shell";
import type { DesktopAttachment, SystemAppearance } from "@/types/gode";

type ToolPanel = "terminal" | "browser" | "canvas" | null;

export function App(): React.JSX.Element {
  const teamState = useRoderTeam();
  const debugEvents = useDebugEventStore((state) => state.events);
  const clearDebugEvents = useDebugEventStore((state) => state.clear);
  const settingsOpen = useThemeStore((state) => state.settingsOpen);
  const openSettings = useThemeStore((state) => state.openSettings);
  const [appearance, setAppearance] = useState<SystemAppearance>("light");
  const [activeDrawer, setActiveDrawer] = useState<TeamDrawer>({ type: "details" });
  const [activeTool, setActiveTool] = useState<ToolPanel>(null);
  const [toolPanelWidth, setToolPanelWidth] = useState(560);
  const [serverError, setServerError] = useState<string | null>(null);
  useThemeApplication(appearance);

  useEffect(() => {
    const offAppearance = godeIpc.onAppearance(setAppearance);
    void godeIpc.appearance().then(setAppearance);
    void godeIpc.start().catch((error: Error) => setServerError(error.message));
    return () => {
      offAppearance();
    };
  }, []);

  const shellTeam = useMemo(() => toTeamShellTeam(teamState.activeTeam), [teamState.activeTeam]);
  const members = useMemo(() => toTeamShellMembers(teamState.activeTeam), [teamState.activeTeam]);
  const messages = useMemo(() => toTeamShellMessages(teamState.activeMessages), [teamState.activeMessages]);
  const activeChannelId = teamState.activeChannelId ?? shellTeam.channels?.[0]?.id ?? "general";

  const sendChannelMessage = useCallback(
    async (channelId: string, body: string) => {
      const teamId = teamState.activeTeamId;
      if (!teamId) {
        recordDebugEvent({ source: "shell", event: "send-channel:no-team", level: "warn", payload: { channelId, text: body } });
        return;
      }
      recordDebugEvent({ source: "shell", event: "send-channel", payload: { teamId, channelId, text: body } });
      await teamState.sendChannelMessage({
        teamId,
        channelId,
        text: body,
      });
    },
    [teamState],
  );

  const sendMemberDM = useCallback(
    async (memberId: string, body: string) => {
      const teamId = teamState.activeTeamId;
      if (!teamId || memberId === "system") {
        recordDebugEvent({ source: "shell", event: "send-dm:skipped", level: "warn", payload: { teamId, memberId, text: body } });
        return;
      }
      recordDebugEvent({ source: "shell", event: "send-dm", payload: { teamId, memberId, text: body } });
      await teamState.sendMemberMessage({
        teamId,
        memberId,
        channelId: null,
        text: body,
      });
    },
    [teamState],
  );

  const toggleScheduler = useCallback(() => {
    void teamState.setSchedulerRunning(!teamState.schedulerRunning);
  }, [teamState]);

  const openAppDrawer = useCallback(
    (appId?: TeamAppId) => {
      if (!appId) {
        setActiveDrawer({ type: "apps" });
        return;
      }
      if (appId === "events") {
        setActiveDrawer({ type: "events" });
        return;
      }
      setActiveDrawer({ type: "apps", appId });
      if (appId === "settings") {
        openSettings("appearance");
        return;
      }
      setActiveTool((current) => (current === appId ? null : appId));
    },
    [openSettings],
  );

  const stopMember = useCallback(
    (memberId: string) => {
      void teamState.interruptMember(memberId);
    },
    [teamState],
  );

  const attachToContext = useCallback((_attachment: DesktopAttachment) => {
    setActiveDrawer({ type: "details" });
  }, []);

  const beginToolPanelResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      beginHorizontalResize(event, toolPanelWidth, (startWidth, deltaX) => {
        setToolPanelWidth(clamp(startWidth - deltaX, 360, 820));
      });
    },
    [toolPanelWidth],
  );

  const statusError = teamState.error ?? serverError;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground">
      <TitleCommandBar onOpenSettings={() => openSettings("appearance")} />
      {settingsOpen && <SettingsView />}
      <div className="relative flex h-full w-full pt-11">
        <section className="h-full min-w-0 flex-1">
          <TeamShell
            team={shellTeam}
            activeChannelId={activeChannelId}
            messages={messages}
            members={members}
            debugEvents={debugEvents}
            activeDrawer={activeDrawer}
            schedulerRunning={teamState.schedulerRunning}
            onSelectChannel={teamState.selectChannel}
            onSendChannelMessage={sendChannelMessage}
            onSendMemberDM={sendMemberDM}
            onToggleScheduler={toggleScheduler}
            onOpenAppDrawer={openAppDrawer}
            onOpenDrawer={setActiveDrawer}
            onClearDebugEvents={clearDebugEvents}
            onStopMember={stopMember}
          />
        </section>
        {activeTool && (
          <div className="relative h-full min-w-0 shrink-0 border-l border-border bg-background" style={{ width: toolPanelWidth }}>
            <div
              className="no-drag absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize bg-transparent hover:bg-border"
              aria-label="Resize app panel"
              role="separator"
              onPointerDown={beginToolPanelResize}
            />
            {activeTool === "terminal" && <TerminalPanel />}
            {activeTool === "browser" && <BrowserPanel onAttach={attachToContext} />}
            {activeTool === "canvas" && <CanvasPanel onAttach={attachToContext} />}
          </div>
        )}
      </div>
      {(!teamState.hydrated || teamState.busy || statusError) && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-lg">
          {!statusError && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {statusError && <AlertCircle className="size-4 text-destructive" />}
          <span className="max-w-[560px] truncate">
            {statusError ?? (teamState.hydrated ? "Syncing team state" : "Starting Roder team")}
          </span>
          {teamState.activeTeam && (
            <Badge variant="muted" className="text-[11px]">
              {teamState.activeTeam.provider}/{teamState.activeTeam.model}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function TitleCommandBar({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  return (
    <header className="drag-region absolute inset-x-0 top-0 z-[60] flex h-11 items-center border-b border-white/10 bg-[linear-gradient(90deg,#064563_0%,#17385a_42%,#1c0b34_100%)] pl-[112px] pr-3 text-white shadow-sm">
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <button
          type="button"
          aria-label="Back"
          className="no-drag flex size-8 items-center justify-center rounded-md text-white/58 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="size-5" />
        </button>
        <button
          type="button"
          aria-label="Forward"
          className="no-drag flex size-8 items-center justify-center rounded-md text-white/58 hover:bg-white/10 hover:text-white"
        >
          <ArrowRight className="size-5" />
        </button>
        <button
          type="button"
          aria-label="History"
          className="no-drag flex size-8 items-center justify-center rounded-md text-white/85 hover:bg-white/10"
        >
          <Clock3 className="size-5" />
        </button>
        <label className="no-drag flex h-8 min-w-[280px] max-w-[720px] flex-1 items-center gap-2 rounded-md border border-white/10 bg-white/26 px-3 text-sm text-white shadow-inner">
          <Search className="size-4 shrink-0 text-white/86" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/78"
            placeholder="Describe what you are looking for"
            aria-label="Search Roder"
          />
        </label>
        <button
          type="button"
          aria-label="Profile"
          className="no-drag ml-1 flex size-8 items-center justify-center rounded-lg border border-white/16 bg-white/18 text-[15px] shadow-sm hover:bg-white/24"
        >
          R
        </button>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2 pl-4">
        <button
          type="button"
          aria-label="Toggle sidebar"
          className="no-drag flex h-8 items-center gap-1 rounded-lg border border-white/18 bg-white/8 px-2 text-white/80 hover:bg-white/14 hover:text-white"
        >
          <PanelLeft className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Help"
          className="no-drag flex size-8 items-center justify-center rounded-md text-white/82 hover:bg-white/10 hover:text-white"
          onClick={onOpenSettings}
        >
          <HelpCircle className="size-5" />
        </button>
      </div>
    </header>
  );
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
