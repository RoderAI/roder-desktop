import { ArrowLeft, ArrowRight, Camera, ExternalLink, Highlighter, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DesktopAttachment, BrowserSnapshot } from "@/types/gode";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BrowserPanelProps = {
  onAttach: (attachment: DesktopAttachment) => void;
};

export function BrowserPanel({ onAttach }: BrowserPanelProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [location, setLocation] = useState("https://www.google.com/search?q=roder");
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    let disposed = false;
    const syncBounds = async (): Promise<void> => {
      if (disposed || !viewport.isConnected) {
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const bounds = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
      const next = await window.godeDesktop.browserShow(bounds);
      if (!disposed) {
        setSnapshot(next);
      }
    };

    const resizeObserver = new ResizeObserver(() => void syncBounds());
    resizeObserver.observe(viewport);
    window.addEventListener("resize", syncBounds);
    requestAnimationFrame(() => void syncBounds());

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncBounds);
      void window.godeDesktop.browserHide();
    };
  }, []);

  async function navigate(): Promise<void> {
    const next = await window.godeDesktop.browserNavigate(location);
    setSnapshot(next);
    setLocation(next.url);
  }

  async function captureScreenshot(): Promise<void> {
    setCapturing(true);
    try {
      const file = await window.godeDesktop.browserCaptureScreenshot();
      onAttach({ ...file, id: crypto.randomUUID() });
    } finally {
      setCapturing(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col border-l border-border bg-card">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <ToolbarButton
          label="Back"
          disabled={!snapshot?.canGoBack}
          onClick={async () => {
            const next = await window.godeDesktop.browserBack();
            setSnapshot(next);
            setLocation(next.url);
          }}
        >
          <ArrowLeft className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Forward"
          disabled={!snapshot?.canGoForward}
          onClick={async () => {
            const next = await window.godeDesktop.browserForward();
            setSnapshot(next);
            setLocation(next.url);
          }}
        >
          <ArrowRight className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Refresh"
          onClick={async () => {
            const next = await window.godeDesktop.browserRefresh();
            setSnapshot(next);
          }}
        >
          <RefreshCw className="size-4" />
        </ToolbarButton>
        <input
          value={location}
          className="mx-1 h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          onChange={(event) => setLocation(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void navigate();
            }
          }}
        />
        <button
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label="Navigate browser"
          onClick={() => void navigate()}
        >
          <ExternalLink className="size-4" />
        </button>
        <ToolbarButton label="Attach screenshot" disabled={capturing} onClick={captureScreenshot}>
          <Camera className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={snapshot?.annotating ? "Hide HTML annotations" : "Annotate HTML"}
          className={cn(snapshot?.annotating && "bg-accent text-accent-foreground")}
          onClick={async () => {
            const next = await window.godeDesktop.browserToggleAnnotation();
            setSnapshot(next);
          }}
        >
          <Highlighter className="size-4" />
        </ToolbarButton>
      </div>
      <div ref={viewportRef} className="min-h-0 flex-1 bg-[#111]" />
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border px-3 text-[11px] text-muted-foreground">
        <span>CDP</span>
        <span className="truncate">{snapshot?.cdpUrl ?? "starting..."}</span>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  className,
  disabled,
  children,
  onClick,
}: {
  label: string;
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void | Promise<void>;
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-8 shrink-0 rounded-md text-muted-foreground", className)}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => void onClick()}
    >
      {children}
    </Button>
  );
}
