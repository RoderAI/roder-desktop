import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef } from "react";
import { terminalThemeForSettings } from "@/lib/terminal-theme";
import { useThemeStore } from "@/stores/theme-store";

type TerminalPanelProps = {
  active?: boolean;
  cwd: string;
};

export function TerminalPanel({ active = true, cwd }: TerminalPanelProps): React.JSX.Element {
  const terminalThemeSettings = useThemeStore((state) => state.settings.terminalTheme);
  const codeFont = useThemeStore((state) => state.settings.dark.codeFont);
  const codeFontSize = useThemeStore((state) => state.settings.codeFontSize);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeRef = useRef(active);
  const startedRef = useRef(false);

  const fitAndResize = useCallback((focus = false): void => {
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
      void window.roderDesktop.terminalResize(terminal.cols, terminal.rows);
    } else {
      startedRef.current = true;
      void window.roderDesktop.terminalStart({ cols: terminal.cols, rows: terminal.rows, cwd });
    }
    if (focus) {
      terminal.focus();
    }
  }, []);

  useEffect(() => {
    activeRef.current = active;
    if (!active) {
      return;
    }
    requestAnimationFrame(() => fitAndResize(true));
  }, [active, fitAndResize]);

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
      lineHeight: 1,
      minimumContrastRatio: 1,
      theme: terminalThemeForSettings(terminalThemeSettings),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;

    const offData = window.roderDesktop.onTerminalData((payload) => terminal.write(payload.data));
    const offExit = window.roderDesktop.onTerminalExit((payload) => {
      terminal.writeln("");
      terminal.writeln(`[process exited: ${payload.exitCode}]`);
    });
    const inputDisposable = terminal.onData((data) => {
      void window.roderDesktop.terminalWrite(data);
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
  }, [codeFont, codeFontSize, fitAndResize, terminalThemeSettings]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.options.fontFamily = codeFont;
    terminal.options.fontSize = codeFontSize;
    terminal.options.theme = terminalThemeForSettings(terminalThemeSettings);
    requestAnimationFrame(() => fitAndResize());
  }, [codeFont, codeFontSize, fitAndResize, terminalThemeSettings]);

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-[var(--terminal-background,#1e1e2e)]">
      <div className="flex h-10 shrink-0 items-center border-b border-border px-3 text-base text-muted-foreground">
        Terminal
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 p-2" />
    </div>
  );
}
