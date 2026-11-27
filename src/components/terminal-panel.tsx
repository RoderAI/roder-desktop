import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Cloud, RotateCw } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActiveRemoteWorkspace } from "@/lib/cloud-machines";
import { terminalThemeForSettings } from "@/lib/terminal-theme";
import { useThemeStore } from "@/stores/theme-store";

type TerminalPanelProps = {
  active?: boolean;
  cwd: string;
  remoteWorkspace?: ActiveRemoteWorkspace | null;
};

export function TerminalPanel({ active = true, cwd, remoteWorkspace = null }: TerminalPanelProps): React.JSX.Element {
  const sessionId = remoteWorkspace ? remoteWorkspace.workspaceId : `local:${cwd || "primary"}`;
  const [reconnectGeneration, setReconnectGeneration] = useState(0);

  return (
    <TerminalPanelSession
      key={`${sessionId}:${reconnectGeneration}`}
      active={active}
      sessionId={sessionId}
      cwd={cwd}
      remoteWorkspace={remoteWorkspace}
      forceRestart={reconnectGeneration > 0}
      onReconnect={() => setReconnectGeneration((count) => count + 1)}
    />
  );
}

function TerminalPanelSession({
  active,
  sessionId,
  cwd,
  remoteWorkspace,
  forceRestart,
  onReconnect,
}: {
  active: boolean;
  sessionId: string;
  cwd: string;
  remoteWorkspace: ActiveRemoteWorkspace | null;
  forceRestart: boolean;
  onReconnect: () => void;
}): React.JSX.Element {
  const terminalThemeSettings = useThemeStore((state) => state.settings.terminalTheme);
  const codeFont = useThemeStore((state) => state.settings.dark.codeFont);
  const codeFontSize = useThemeStore((state) => state.settings.codeFontSize);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeRef = useRef(active);
  const startedRef = useRef(false);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "error">(
    remoteWorkspace ? "connecting" : "connected",
  );

  const fitAndResize = useEffectEvent((focus = false): void => {
    if (!activeRef.current) {
      return;
    }
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) {
      return;
    }
    fit.fit();
    if (startedRef.current) {
      void window.roderDesktop.terminalResize(terminal.cols, terminal.rows, sessionId);
    } else {
      startedRef.current = true;
      if (remoteWorkspace) {
        setConnectionState("connecting");
      }
      void window.roderDesktop
        .terminalStart({
          id: sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
          cwd,
          remoteWorkspaceId: remoteWorkspace?.workspaceId,
          forceRestart,
        })
        .then(() => {
          setConnectionState("connected");
        })
        .catch((error: unknown) => {
          setConnectionState("error");
          const message = error instanceof Error ? error.message : "Could not start terminal session.";
          terminal.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
        });
    }
    if (focus) {
      terminal.focus();
    }
  });

  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      return;
    }
    requestAnimationFrame(() => fitAndResize(true));
  }, [active]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      drawBoldTextInBrightColors: true,
      fontFamily: codeFont,
      fontSize: codeFontSize,
      lineHeight: 0.8,
      minimumContrastRatio: 1,
      theme: terminalThemeForSettings(terminalThemeSettings),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;

    const offData = window.roderDesktop.onTerminalData((payload) => {
      if (payload.id === sessionId) {
        terminal.write(payload.data);
      }
    });
    const offExit = window.roderDesktop.onTerminalExit((payload) => {
      if (payload.id === sessionId) {
        terminal.writeln("");
        terminal.writeln(`[process exited: ${payload.exitCode}]`);
      }
    });
    const inputDisposable = terminal.onData((data) => {
      void window.roderDesktop.terminalWrite(data, sessionId);
    });
    const resizeObserver = new ResizeObserver(() => fitAndResize());
    resizeObserver.observe(host);

    requestAnimationFrame(() => fitAndResize(true));

    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
      offData();
      offExit();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      startedRef.current = false;
    };
  }, [codeFont, codeFontSize, sessionId, terminalThemeSettings]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.options.fontFamily = codeFont;
    terminal.options.fontSize = codeFontSize;
    terminal.options.theme = terminalThemeForSettings(terminalThemeSettings);
    requestAnimationFrame(() => fitAndResize());
  }, [codeFont, codeFontSize, terminalThemeSettings]);

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-[var(--terminal-background,#1e1e2e)]">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3 text-base text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-medium text-foreground">Terminal</span>
          {remoteWorkspace && (
            <span
              className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted/40 px-2 py-0.5 text-sm text-muted-foreground"
              title={`${remoteWorkspace.providerId} · ${remoteWorkspace.targetName}:${remoteWorkspace.workspacePath}`}
            >
              <Cloud className="size-3.5 shrink-0" />
              <span className="truncate font-mono">
                {remoteWorkspace.label}:{remoteWorkspace.workspacePath}
              </span>
              {connectionState === "connecting" && <span className="shrink-0 text-xs">Connecting…</span>}
            </span>
          )}
        </div>
        {remoteWorkspace && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 rounded-md text-muted-foreground hover:text-foreground"
            aria-label="Reconnect remote terminal"
            title="Reconnect remote terminal"
            onClick={onReconnect}
          >
            <RotateCw className="size-3.5" />
          </Button>
        )}
      </div>
      <div ref={hostRef} className="terminal-host min-h-0 flex-1 p-2" />
    </div>
  );
}
