import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  claudeMenuKey,
  claudeMenuText,
  claudeMenuTitles,
  type ClaudeMenuInvocation,
  type ClaudeTerminalFrame,
} from "@/lib/claude-code-menu";

function readTerminal(threadId: string) {
  return window.roderDesktop.request("thread/terminal/read", { threadId }) as Promise<ClaudeTerminalFrame>;
}

function terminalKey(threadId: string, key: string) {
  return window.roderDesktop.request("thread/terminal/input", { threadId, input: { kind: "key", key } });
}

export function ClaudeCodeMenu({
  threadId,
  invocation,
  onClose,
}: {
  threadId: string;
  invocation: ClaudeMenuInvocation;
  onClose: () => void;
}): React.JSX.Element {
  const { command, arguments: args } = invocation;
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const terminalMode = useRef<"waiting" | "trust" | "menu">("waiting");
  const terminalFocus = useRef<HTMLDivElement>(null);
  const dismiss = useEffectEvent(onClose);

  function sendKey(key: string) {
    void terminalKey(threadId, key).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }

  useEffect(() => {
    let cancelled = false;
    let submitted: Promise<unknown> | null = null;
    let opened = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 20_000;

    async function poll() {
      try {
        const frame = await readTerminal(threadId);
        if (cancelled) return;
        if (frame.closed) throw new Error("Claude Code exited. Reopen the conversation to reconnect.");
        if (!submitted && frame.readyForTurn) {
          terminalMode.current = "waiting";
          submitted = window.roderDesktop.request("thread/terminal/input", {
            threadId,
            input: { kind: "command", command, arguments: args },
          });
          await submitted;
        } else if (opened && frame.readyForTurn) {
          submitted = null;
          dismiss();
          return;
        } else if (!frame.readyForTurn) {
          const trust = frame.lines.some((line) => line.includes("Yes, I trust this folder"));
          if (trust || submitted) {
            const panel = claudeMenuText(frame, command);
            setText(panel);
            opened ||= Boolean(submitted && panel);
            terminalMode.current = trust ? "trust" : opened ? "menu" : "waiting";
          }
        }
        if (cancelled) return;
        if (terminalMode.current === "waiting" && Date.now() >= deadline) {
          throw new Error("Claude Code did not open the menu. Finish the current turn and try again.");
        }
        timer = setTimeout(() => void poll(), 160);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      terminalMode.current = "waiting";
      void submitted
        ?.then(async () => {
          const frame = await readTerminal(threadId);
          if (!frame.closed && !frame.readyForTurn) await terminalKey(threadId, "Escape");
        })
        .catch(() => undefined);
    };
  }, [threadId, command, args]);

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === "escape-key" && terminalMode.current === "menu") {
          details.cancel();
          sendKey("Escape");
        } else {
          onClose();
        }
      }}
    >
      <DialogContent
        ref={terminalFocus}
        className="max-w-3xl"
        initialFocus={terminalFocus}
        onKeyDown={(event) => {
          if (event.target !== terminalFocus.current || event.key === "Escape") return;
          const key = claudeMenuKey(event.key);
          if (terminalMode.current === "waiting" || !key || event.metaKey || event.ctrlKey || event.altKey) return;
          event.preventDefault();
          event.stopPropagation();
          sendKey(key);
        }}
      >
        <DialogHeader>
          <DialogTitle>{claudeMenuTitles[command]}</DialogTitle>
        </DialogHeader>
        <div className="overflow-auto rounded-lg bg-muted/30 p-3">
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : text ? (
            <pre className="font-mono text-sm">{text}</pre>
          ) : (
            <p role="status" className="text-muted-foreground">
              Opening Claude Code…
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
