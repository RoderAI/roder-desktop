import { ArrowLeft, ArrowRight, Camera, ExternalLink, Highlighter, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopAttachment, BrowserSnapshot } from "@/types/roder";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NativeOverlayOcclusion } from "@/components/right-workspace-panel-shell";

type BrowserPanelProps = {
  active?: boolean;
  nativeOverlayOcclusion?: NativeOverlayOcclusion | null;
  onAttach: (attachment: DesktopAttachment) => void;
};

export function BrowserPanel({
  active = true,
  nativeOverlayOcclusion = null,
  onAttach,
}: BrowserPanelProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const nativeOverlayOcclusionRef = useRef<NativeOverlayOcclusion | null>(nativeOverlayOcclusion);
  const [location, setLocation] = useState("https://www.google.com/search?q=roder");
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);
  const [capturing, setCapturing] = useState(false);

  nativeOverlayOcclusionRef.current = nativeOverlayOcclusion;

  const syncBrowserBounds = useCallback(async (mode: "show" | "set"): Promise<BrowserSnapshot | null> => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return null;
    }
    const rect = viewport.getBoundingClientRect();
    const bounds = browserBoundsForOcclusion(
      {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      nativeOverlayOcclusionRef.current,
    );
    return mode === "show" ? window.roderDesktop.browserShow(bounds) : window.roderDesktop.browserSetBounds(bounds);
  }, []);

  useEffect(() => {
    if (!active) {
      void window.roderDesktop.browserHide().then(setSnapshot).catch(reportBrowserError);
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    let disposed = false;
    const syncBounds = async (mode: "show" | "set"): Promise<void> => {
      if (disposed || !viewport.isConnected) {
        return;
      }
      try {
        const next = await syncBrowserBounds(mode);
        if (!disposed && next) {
          setSnapshot(next);
        }
      } catch (error) {
        reportBrowserError(error);
      }
    };

    const resizeObserver = new ResizeObserver(() => void syncBounds("set"));
    resizeObserver.observe(viewport);
    const handleResize = () => void syncBounds("set");
    window.addEventListener("resize", handleResize);
    requestAnimationFrame(() => void syncBounds("show"));

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      void window.roderDesktop.browserHide().catch(reportBrowserError);
    };
  }, [active, syncBrowserBounds]);

  useEffect(() => {
    if (!active) {
      return;
    }
    let disposed = false;
    const syncBounds = async (): Promise<void> => {
      try {
        const next = await syncBrowserBounds("set");
        if (!disposed && next) {
          setSnapshot(next);
        }
      } catch (error) {
        reportBrowserError(error);
      }
    };
    void syncBounds();
    return () => {
      disposed = true;
    };
  }, [active, nativeOverlayOcclusion, syncBrowserBounds]);

  async function navigate(): Promise<void> {
    const next = await window.roderDesktop.browserNavigate(location);
    setSnapshot(next);
    setLocation(next.url);
  }

  async function captureScreenshot(): Promise<void> {
    setCapturing(true);
    try {
      const file = await window.roderDesktop.browserCaptureScreenshot();
      onAttach({ ...file, id: crypto.randomUUID(), source: "browser" });
    } finally {
      setCapturing(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <ToolbarButton
          label="Back"
          disabled={!snapshot?.canGoBack}
          onClick={async () => {
            const next = await window.roderDesktop.browserBack();
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
            const next = await window.roderDesktop.browserForward();
            setSnapshot(next);
            setLocation(next.url);
          }}
        >
          <ArrowRight className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Refresh"
          onClick={async () => {
            const next = await window.roderDesktop.browserRefresh();
            setSnapshot(next);
          }}
        >
          <RefreshCw className="size-4" />
        </ToolbarButton>
        <input
          value={location}
          aria-label="Browser URL"
          className="mx-1 h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-base text-foreground outline-none focus:ring-2 focus:ring-ring"
          onChange={(event) => setLocation(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void navigate();
            }
          }}
        />
        <button
          type="button"
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
            const next = await window.roderDesktop.browserToggleAnnotation();
            setSnapshot(next);
          }}
        >
          <Highlighter className="size-4" />
        </ToolbarButton>
      </div>
      <div ref={viewportRef} className="min-h-0 flex-1 bg-[#111]" />
      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-base text-muted-foreground">
        <span>CDP</span>
        <span className="truncate">{snapshot?.cdpUrl ?? "starting..."}</span>
      </div>
    </div>
  );
}

function browserBoundsForOcclusion(
  bounds: { x: number; y: number; width: number; height: number },
  occlusion: NativeOverlayOcclusion | null,
): { x: number; y: number; width: number; height: number } {
  if (!occlusion || !rectsOverlap(bounds, occlusion)) {
    return bounds;
  }

  const boundsBottom = bounds.y + bounds.height;
  const occlusionBottom = occlusion.y + occlusion.height;
  const nextY = Math.min(boundsBottom, Math.max(bounds.y, occlusionBottom));

  return {
    x: bounds.x,
    y: nextY,
    width: bounds.width,
    height: Math.max(0, boundsBottom - nextY),
  };
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function reportBrowserError(error: unknown): void {
  console.error("Browser panel IPC failed:", error);
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
