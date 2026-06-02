import { useEffect, useRef, useState } from "react";
import { extensionsIpc } from "@/lib/extensions-ipc";
import type { AppServerEvent } from "@/types/roder";

type ExtensionWebviewPanelProps = {
  extensionId: string;
  panelId: string;
  title: string;
};

type PanelHtmlState = {
  key: string;
  html: string | null;
  error: string | null;
};

export function ExtensionWebviewPanel({ extensionId, panelId, title }: ExtensionWebviewPanelProps): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const panelKey = `${extensionId}\0${panelId}`;
  const [panelHtmlState, setPanelHtmlState] = useState<PanelHtmlState | null>(null);
  const currentPanelState = panelHtmlState?.key === panelKey ? panelHtmlState : null;
  const html = currentPanelState?.html ?? null;
  const error = currentPanelState?.error ?? null;

  useEffect(() => {
    let disposed = false;
    extensionsIpc
      .readPanel(extensionId, panelId)
      .then((nextHtml) => {
        if (!disposed) {
          setPanelHtmlState({ key: panelKey, html: nextHtml, error: null });
        }
      })
      .catch((nextError: Error) => {
        if (!disposed) {
          setPanelHtmlState({ key: panelKey, html: null, error: nextError.message });
        }
      });
    return () => {
      disposed = true;
    };
  }, [extensionId, panelId, panelKey]);

  useEffect(() => {
    if (!html) {
      return;
    }
    let disposed = false;

    async function sendHistory(): Promise<void> {
      const events = await window.roderDesktop.appServerEvents();
      if (!disposed) {
        postToPanel({ type: "roder:appServerEvents", events });
      }
    }

    const unsubscribe = window.roderDesktop.onAppServerEvent((event) => {
      postToPanel({ type: "roder:appServerEvent", event });
    });
    const frame = iframeRef.current;
    frame?.addEventListener("load", () => void sendHistory(), { once: true });
    void sendHistory();

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [html]);

  function postToPanel(message: { type: string; event?: AppServerEvent; events?: AppServerEvent[] }): void {
    iframeRef.current?.contentWindow?.postMessage(message, "*");
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-base text-destructive">{error}</div>
    );
  }

  if (!html) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-base text-muted-foreground">
        Loading {title}...
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      title={title}
      sandbox="allow-scripts"
      className="h-full w-full bg-background"
      srcDoc={html}
    />
  );
}
