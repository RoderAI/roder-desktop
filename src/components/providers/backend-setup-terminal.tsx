import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { LoaderCircle, RefreshCw, Terminal as TerminalIcon, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { terminalThemeForSettings } from "@/lib/terminal-theme";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/theme-store";
import type { ExternalAgentBackendId } from "@/types/roder";

export const ANTIGRAVITY_SETUP_SESSION_ID = "setup:antigravity";
export const CODEX_SETUP_SESSION_ID = "setup:codex";

type BackendSetupTerminalProps = {
  backend: ExternalAgentBackendId;
  antigravityMode?: "login" | "install";
  checking: boolean;
  onCheckConnection: () => Promise<void>;
  onAutoComplete: () => Promise<void>;
  onClose: () => void;
};

export function BackendSetupTerminal({
  backend,
  antigravityMode = "login",
  checking,
  onCheckConnection,
  onAutoComplete,
  onClose,
}: BackendSetupTerminalProps): React.JSX.Element {
  const sessionId = backend === "codex" ? CODEX_SETUP_SESSION_ID : ANTIGRAVITY_SETUP_SESSION_ID;
  const terminalThemeSettings = useThemeStore((state) => state.settings.terminalTheme);
  const codeFont = useThemeStore((state) => state.settings.dark.codeFont);
  const codeFontSize = useThemeStore((state) => state.settings.codeFontSize);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [exitedCode, setExitedCode] = useState<number | null>(null);

  const handleComplete = useEffectEvent(() => {
    void onAutoComplete();
  });

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
      lineHeight: 1.1,
      minimumContrastRatio: 1,
      theme: terminalThemeForSettings(terminalThemeSettings),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;

    let started = false;
    const fitAndResize = (focus = false) => {
      fit.fit();
      if (started) {
        void window.roderDesktop.terminalResize(terminal.cols, terminal.rows, sessionId);
      } else {
        started = true;
        void window.roderDesktop
          .terminalStart({
            id: sessionId,
            cols: Math.max(terminal.cols, 60),
            rows: Math.max(terminal.rows, 14),
            forceRestart: true,
            ...(backend === "antigravity" ? { antigravitySetupMode: antigravityMode } : {}),
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "Could not start backend setup.";
            terminal.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
          });
      }
      if (focus) {
        terminal.focus();
      }
    };

    const offData = window.roderDesktop.onTerminalData((payload) => {
      if (payload.id === sessionId) {
        terminal.write(payload.data);
      }
    });
    const offExit = window.roderDesktop.onTerminalExit((payload) => {
      if (payload.id === sessionId) {
        setExitedCode(payload.exitCode);
        if (payload.exitCode === 0) {
          terminal.writeln("\r\n\x1b[32mSetup finished. Verifying connection...\x1b[0m");
          handleComplete();
        } else {
          terminal.writeln(`\r\n[process exited: ${payload.exitCode}]`);
        }
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
      void window.roderDesktop.terminalStop(sessionId).catch(() => undefined);
    };
  }, [antigravityMode, backend, codeFont, codeFontSize, sessionId, terminalThemeSettings]);

  const title =
    backend === "codex"
      ? "Codex CLI sign-in"
      : antigravityMode === "install"
        ? "Install Antigravity CLI & sign in"
        : "Antigravity Google sign-in";

  const subtitle =
    backend === "codex"
      ? exitedCode === 0
        ? "Sign-in finished. Connecting Codex backend models..."
        : "Complete the Codex CLI login flow below. This card updates when sign-in completes."
      : antigravityMode === "install"
        ? "Follow the prompts below to download the official Antigravity CLI and sign in with Google, then click Check connection."
        : exitedCode === 0
          ? "Sign-in finished. Connecting Antigravity models..."
          : "Complete the Google sign-in flow below (press Enter or open the URL if prompted). This card updates when sign-in completes.";

  return (
    <div className="overflow-hidden rounded-xl bg-background ring-1 ring-border/70">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          {checking && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" disabled={checking} onClick={() => void onCheckConnection()}>
            <RefreshCw className={cn("size-3.5", checking && "animate-spin motion-reduce:animate-none")} />
            Check connection
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="rounded-md text-muted-foreground hover:text-foreground"
            aria-label={`Close ${title} terminal`}
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="border-b border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{subtitle}</div>
      <div ref={hostRef} className="terminal-host h-[220px] w-full bg-[var(--terminal-background,#1e1e2e)] p-2" />
    </div>
  );
}
