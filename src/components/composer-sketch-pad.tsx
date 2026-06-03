import { ImagePlus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DesktopAttachment } from "@/types/roder";
import {
  drawStroke,
  fitCanvasImageRect,
  loadCanvasImage,
  pointFromClient,
  type CanvasImage,
  type Point,
  type Stroke,
} from "@/lib/canvas-surface";
import { cn } from "@/lib/utils";

type ComposerSketchPadProps = {
  onAttach: (attachment: DesktopAttachment) => void;
  onClose: () => void;
};

const sketchInkColor = "#18181b";
const sketchInkWidth = 4;
const markerColors = [sketchInkColor, "#f97316", "#facc15", "#22c55e", "#38bdf8", "#a78bfa", "#f472b6"];

export function ComposerSketchPad({ onAttach, onClose }: ComposerSketchPadProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagesRef = useRef<CanvasImage[]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const orderRef = useRef(0);
  const [color, setColor] = useState(sketchInkColor);
  const [hasContent, setHasContent] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.floor(rect.width * scale));
    const nextHeight = Math.max(1, Math.floor(rect.height * scale));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    for (const image of imagesRef.current) {
      context.drawImage(image.image, image.x, image.y, image.width, image.height);
    }
    for (const stroke of strokesRef.current) {
      drawStroke(context, stroke);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const observer = new ResizeObserver(() => redraw());
    observer.observe(canvas);
    requestAnimationFrame(() => {
      canvas.focus();
      redraw();
    });
    return () => observer.disconnect();
  }, [redraw]);

  useEffect(
    () => () => {
      revokeImages(imagesRef.current);
    },
    [],
  );

  function beginStroke(event: React.PointerEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke: Stroke = {
      id: crypto.randomUUID(),
      color,
      width: sketchInkWidth,
      order: nextOrder(),
      points: [pointFromEvent(event)],
    };
    activeStrokeRef.current = stroke;
    strokesRef.current = [...strokesRef.current, stroke];
    setHasContent(true);
    redraw();
  }

  function moveStroke(event: React.PointerEvent<HTMLCanvasElement>): void {
    const stroke = activeStrokeRef.current;
    if (!stroke) {
      return;
    }
    event.preventDefault();
    stroke.points.push(pointFromEvent(event));
    redraw();
  }

  function endStroke(event: React.PointerEvent<HTMLCanvasElement>): void {
    activeStrokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function clear(): void {
    revokeImages(imagesRef.current);
    imagesRef.current = [];
    strokesRef.current = [];
    activeStrokeRef.current = null;
    orderRef.current = 0;
    setHasContent(false);
    redraw();
  }

  async function handleUseSketch(): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas || !hasContent) {
      return;
    }
    setCapturing(true);
    try {
      redraw();
      const imageUrl = canvas.toDataURL("image/png");
      const file = await window.roderDesktop.canvasSavePng(imageUrl);
      onAttach({ ...file, id: crypto.randomUUID(), imageUrl, source: "canvas" });
      onClose();
    } finally {
      setCapturing(false);
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLCanvasElement>): void {
    const imageFiles = pastedImageFiles(event.clipboardData);
    if (imageFiles.length === 0) {
      return;
    }
    event.preventDefault();
    void addPastedImages(imageFiles);
  }

  async function addPastedImages(files: File[]): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const loaded = await Promise.all(files.map((file) => loadCanvasImage(file)));
    const rect = canvas.getBoundingClientRect();
    const placed = loaded.map((image, index) => ({
      ...image,
      ...fitCanvasImageRect({
        imageHeight: image.image.naturalHeight,
        imageWidth: image.image.naturalWidth,
        surfaceHeight: rect.height,
        surfaceWidth: rect.width,
        offset: index * 12,
      }),
    }));
    imagesRef.current = [...imagesRef.current, ...placed];
    setHasContent(true);
    redraw();
  }

  function nextOrder(): number {
    orderRef.current += 1;
    return orderRef.current;
  }

  return (
    <div className="border-b border-border p-3">
      <div className="overflow-hidden rounded-xl bg-white shadow-inner ring-1 ring-border/70">
        <canvas
          ref={canvasRef}
          className="block h-40 w-full touch-none cursor-crosshair"
          aria-label="Sketch input, paste images to annotate"
          tabIndex={0}
          onPointerDown={beginStroke}
          onPointerMove={moveStroke}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPaste={handlePaste}
          onPointerLeave={(event) => {
            if (activeStrokeRef.current) {
              endStroke(event);
            }
          }}
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {markerColors.map((markerColor) => (
            <button
              key={markerColor}
              type="button"
              className={cn(
                "size-5 shrink-0 rounded-full border border-border ring-offset-2 ring-offset-card",
                color === markerColor && "ring-2 ring-ring",
              )}
              style={{ backgroundColor: markerColor }}
              aria-label={`Use marker color ${markerColor}`}
              title={markerColor}
              onClick={() => setColor(markerColor)}
            />
          ))}
        </div>
        <Button variant="ghost" size="sm" className="h-8 rounded-md px-2" disabled={!hasContent} onClick={clear}>
          <Trash2 className="size-4" />
          <span>Clear</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-md text-muted-foreground"
          aria-label="Close sketch"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
        <Button
          size="sm"
          className="h-8 rounded-md px-2.5"
          disabled={!hasContent || capturing}
          onClick={() => void handleUseSketch()}
        >
          <ImagePlus className="size-4" />
          <span>Use sketch</span>
        </Button>
      </div>
    </div>
  );
}

function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>): Point {
  return pointFromClient(event.clientX, event.clientY, event.currentTarget);
}

function pastedImageFiles(data: DataTransfer): File[] {
  const files = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
  if (files.length > 0) {
    return files;
  }
  return Array.from(data.items).flatMap((item) => {
    const file = item.kind === "file" && item.type.startsWith("image/") ? item.getAsFile() : null;
    return file ? [file] : [];
  });
}

function revokeImages(images: CanvasImage[]): void {
  for (const image of images) {
    URL.revokeObjectURL(image.objectUrl);
  }
}
