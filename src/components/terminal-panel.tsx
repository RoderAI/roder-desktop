import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef } from "react";

type TerminalPanelProps = {
  active?: boolean;
};

export function TerminalPanel({ active = true }: TerminalPanelProps): React.JSX.Element {
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
      void window.roderDesktop.terminalStart({ cols: terminal.cols, rows: terminal.rows });
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
      fontFamily: '"SFMono-Regular", "SF Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      theme: {
        background: "#111111",
        foreground: "#d6d6d6",
        cursor: "#f0f0f0",
        selectionBackground: "#4a4a4a",
      },
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
  }, [fitAndResize]);

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-[#111]">
      <div className="flex h-10 shrink-0 items-center border-b border-border px-3 text-base text-muted-foreground">
        Terminal
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 p-2" />
    </div>
  );
}
