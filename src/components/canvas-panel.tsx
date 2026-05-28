import { Camera, Circle, Eraser, Minus, MousePointer2, Pencil, RotateCcw, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopAttachment } from "@/types/roder";
import { CanvasToolbarButton as ToolbarButton } from "@/components/canvas-toolbar-button";
import {
  canvasBackground,
  drawImageSelection,
  drawShape,
  drawStroke,
  hitResizeHandle,
  imageAtPoint,
  imageRect,
  loadCanvasImage,
  pointFromClient,
  resizeImage,
  strokeNearPoint,
  type CanvasImage,
  type CanvasShape,
  type CanvasShapeKind,
  type CanvasTool,
  type ImageInteraction,
  type Point,
  type Stroke,
} from "@/lib/canvas-surface";
import { cn } from "@/lib/utils";

type CanvasPanelProps = {
  onAttach: (attachment: DesktopAttachment) => void;
};

const defaultPencilColor = "#18181b";
const swatches = [defaultPencilColor, "#f8f8f2", "#f97316", "#facc15", "#22c55e", "#38bdf8", "#a78bfa", "#f472b6"];

export function CanvasPanel({ onAttach }: CanvasPanelProps): React.JSX.Element {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagesRef = useRef<CanvasImage[]>([]);
  const shapesRef = useRef<CanvasShape[]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const activeShapeRef = useRef<CanvasShape | null>(null);
  const imageInteractionRef = useRef<ImageInteraction | null>(null);
  const selectedImageIdRef = useRef<string | null>(null);
  const orderRef = useRef(0);
  const [images, setImages] = useState<CanvasImage[]>([]);
  const [shapes, setShapes] = useState<CanvasShape[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [color, setColor] = useState(defaultPencilColor);
  const [width, setWidth] = useState(5);
  const [mode, setMode] = useState<CanvasTool>("draw");
  const [dragActive, setDragActive] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const redraw = useCallback((options: { includeSelection?: boolean } = {}) => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) {
      return;
    }
    const rect = wrapper.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.floor(rect.width * scale));
    const nextHeight = Math.max(1, Math.floor(rect.height * scale));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    context.fillStyle = canvasBackground();
    context.fillRect(0, 0, rect.width, rect.height);

    for (const image of imagesRef.current) {
      context.drawImage(image.image, image.x, image.y, image.width, image.height);
    }
    for (const mark of orderedMarks(shapesRef.current, strokesRef.current)) {
      if (mark.type === "shape") {
        drawShape(context, mark.value);
      } else {
        drawStroke(context, mark.value);
      }
    }
    if (options.includeSelection !== false) {
      const selected = imagesRef.current.find((image) => image.id === selectedImageIdRef.current);
      if (selected) {
        drawImageSelection(context, selected);
      }
    }
  }, []);

  useEffect(() => {
    shapesRef.current = shapes;
    strokesRef.current = strokes;
    redraw();
  }, [redraw, shapes, strokes, images, selectedImageId]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const observer = new ResizeObserver(() => redraw());
    observer.observe(wrapper);
    requestAnimationFrame(() => redraw());
    return () => observer.disconnect();
  }, [redraw]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    selectedImageIdRef.current = selectedImageId;
  }, [selectedImageId]);

  useEffect(
    () => () => {
      for (const image of imagesRef.current) {
        URL.revokeObjectURL(image.objectUrl);
      }
    },
    [],
  );

  function beginStroke(event: React.PointerEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);

    if (mode === "select") {
      const selectedImage = imagesRef.current.find((image) => image.id === selectedImageIdRef.current);
      const selectedHandle = selectedImage ? hitResizeHandle(point, selectedImage) : null;
      if (selectedImage && selectedHandle) {
        imageInteractionRef.current = {
          kind: "resize",
          id: selectedImage.id,
          corner: selectedHandle,
          start: point,
          original: imageRect(selectedImage),
        };
        return;
      }
      const hitImage = imageAtPoint(point, imagesRef.current);
      if (hitImage) {
        selectedImageIdRef.current = hitImage.id;
        setSelectedImageId(hitImage.id);
        imageInteractionRef.current = {
          kind: "move",
          id: hitImage.id,
          start: point,
          original: imageRect(hitImage),
        };
        redraw();
        return;
      }
      selectedImageIdRef.current = null;
      setSelectedImageId(null);
      redraw();
      return;
    }

    selectedImageIdRef.current = null;
    setSelectedImageId(null);

    if (mode === "erase") {
      activeStrokeRef.current = {
        id: "eraser",
        color: "transparent",
        width: width * 3,
        order: nextOrder(),
        points: [point],
      };
      eraseAt(point);
      return;
    }

    if (isShapeTool(mode)) {
      const shape: CanvasShape = {
        id: crypto.randomUUID(),
        kind: mode,
        color,
        width,
        order: nextOrder(),
        start: point,
        end: point,
      };
      activeShapeRef.current = shape;
      const next = [...shapesRef.current, shape];
      shapesRef.current = next;
      setShapes(next);
      return;
    }

    const stroke: Stroke = {
      id: crypto.randomUUID(),
      color,
      width,
      order: nextOrder(),
      points: [point],
    };
    activeStrokeRef.current = stroke;
    const next = [...strokesRef.current, stroke];
    strokesRef.current = next;
    setStrokes(next);
  }

  function moveStroke(event: React.PointerEvent<HTMLCanvasElement>): void {
    const imageInteraction = imageInteractionRef.current;
    if (imageInteraction) {
      event.preventDefault();
      updateImageInteraction(imageInteraction, pointFromEvent(event));
      return;
    }
    const shape = activeShapeRef.current;
    if (shape) {
      event.preventDefault();
      shape.end = pointFromEvent(event);
      redraw();
      return;
    }
    const stroke = activeStrokeRef.current;
    if (!stroke) {
      return;
    }
    event.preventDefault();
    if (mode === "erase") {
      eraseAt(pointFromEvent(event));
      return;
    }
    stroke.points.push(pointFromEvent(event));
    redraw();
  }

  function endStroke(event: React.PointerEvent<HTMLCanvasElement>): void {
    activeStrokeRef.current = null;
    activeShapeRef.current = null;
    imageInteractionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function undo(): void {
    const lastShape = shapesRef.current.at(-1);
    const lastStroke = strokesRef.current.at(-1);
    if (!lastShape && !lastStroke) {
      return;
    }
    if ((lastShape?.order ?? -1) > (lastStroke?.order ?? -1)) {
      const next = shapesRef.current.slice(0, -1);
      shapesRef.current = next;
      setShapes(next);
      return;
    }
    const next = strokesRef.current.slice(0, -1);
    strokesRef.current = next;
    setStrokes(next);
  }

  function eraseAt(point: Point): void {
    const radius = Math.max(8, width * 3);
    const next = strokesRef.current.filter((stroke) => !strokeNearPoint(stroke, point, radius));
    if (next.length !== strokesRef.current.length) {
      strokesRef.current = next;
      setStrokes(next);
    } else {
      redraw();
    }
  }

  function clear(): void {
    for (const image of imagesRef.current) {
      URL.revokeObjectURL(image.objectUrl);
    }
    imagesRef.current = [];
    shapesRef.current = [];
    strokesRef.current = [];
    selectedImageIdRef.current = null;
    setImages([]);
    setShapes([]);
    setStrokes([]);
    setSelectedImageId(null);
  }

  function updateImageInteraction(interaction: ImageInteraction, point: Point): void {
    const nextImages = imagesRef.current.map((image) => {
      if (image.id !== interaction.id) {
        return image;
      }
      const dx = point.x - interaction.start.x;
      const dy = point.y - interaction.start.y;
      if (interaction.kind === "move") {
        return { ...image, x: interaction.original.x + dx, y: interaction.original.y + dy };
      }
      return resizeImage(image, interaction, dx, dy);
    });
    imagesRef.current = nextImages;
    setImages(nextImages);
    redraw();
  }

  async function addDroppedImages(files: FileList | File[], dropPoint?: Point): Promise<void> {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return;
    }
    const loaded = await Promise.all(imageFiles.map((file) => loadCanvasImage(file)));
    const rect = wrapperRef.current?.getBoundingClientRect();
    const maxWidth = Math.max(120, (rect?.width ?? 560) * 0.82);
    const maxHeight = Math.max(120, (rect?.height ?? 420) * 0.72);
    const placed = loaded.map((image, index) => {
      const ratio = Math.min(1, maxWidth / image.image.naturalWidth, maxHeight / image.image.naturalHeight);
      const width = Math.max(80, image.image.naturalWidth * ratio);
      const height = Math.max(80, image.image.naturalHeight * ratio);
      const x = Math.max(12, (dropPoint?.x ?? (rect?.width ?? width) / 2) - width / 2 + index * 18);
      const y = Math.max(12, (dropPoint?.y ?? (rect?.height ?? height) / 2) - height / 2 + index * 18);
      return { ...image, x, y, width, height };
    });
    const next = [...imagesRef.current, ...placed];
    imagesRef.current = next;
    selectedImageIdRef.current = placed.at(-1)?.id ?? null;
    setImages(next);
    setSelectedImageId(selectedImageIdRef.current);
  }

  function nextOrder(): number {
    orderRef.current += 1;
    return orderRef.current;
  }

  async function attachCanvas(): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    setCapturing(true);
    try {
      redraw({ includeSelection: false });
      const file = await window.roderDesktop.canvasSavePng(canvas.toDataURL("image/png"));
      onAttach({ ...file, id: crypto.randomUUID() });
    } finally {
      redraw();
      setCapturing(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col border-l border-border bg-card">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <ToolbarButton label="Draw" active={mode === "draw"} onClick={() => setMode("draw")}>
          <Pencil className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Select and resize images" active={mode === "select"} onClick={() => setMode("select")}>
          <MousePointer2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Erase" active={mode === "erase"} onClick={() => setMode("erase")}>
          <Eraser className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Rectangle" active={mode === "rectangle"} onClick={() => setMode("rectangle")}>
          <Square className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Ellipse" active={mode === "ellipse"} onClick={() => setMode("ellipse")}>
          <Circle className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Line" active={mode === "line"} onClick={() => setMode("line")}>
          <Minus className="size-4" />
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-border" />
        <div className="flex items-center gap-1">
          {swatches.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={cn(
                "size-5 rounded-full border border-border ring-offset-2 ring-offset-card",
                color === swatch && "ring-2 ring-ring",
              )}
              style={{ backgroundColor: swatch }}
              aria-label={`Use color ${swatch}`}
              title={swatch}
              onClick={() => {
                setColor(swatch);
                setMode("draw");
              }}
            />
          ))}
          <input
            value={color}
            type="color"
            className="ml-1 size-7 rounded border border-border bg-transparent p-0.5"
            aria-label="Choose drawing color"
            title="Choose drawing color"
            onChange={(event) => {
              setColor(event.target.value);
              setMode("draw");
            }}
          />
        </div>
        <label className="ml-2 flex items-center gap-2 text-base text-muted-foreground">
          Size
          <input
            value={width}
            type="range"
            min={2}
            max={18}
            className="w-24 accent-primary"
            onChange={(event) => setWidth(Number(event.target.value))}
          />
        </label>
        <div className="ml-auto flex items-center gap-1">
          <ToolbarButton label="Undo mark" disabled={strokes.length === 0 && shapes.length === 0} onClick={undo}>
            <RotateCcw className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Clear canvas"
            disabled={strokes.length === 0 && shapes.length === 0 && images.length === 0}
            onClick={clear}
          >
            <Trash2 className="size-4" />
          </ToolbarButton>
          <ToolbarButton label="Attach canvas screenshot" disabled={capturing} onClick={attachCanvas}>
            <Camera className="size-4" />
          </ToolbarButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-3">
        <div
          ref={wrapperRef}
          className={cn(
            "relative h-full overflow-hidden rounded-xl border border-border bg-background shadow-inner",
            dragActive && "ring-2 ring-ring",
          )}
          onDragEnter={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              setDragActive(true);
            }
          }}
          onDragLeave={(event) => {
            const nextTarget = event.relatedTarget;
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              setDragActive(false);
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            void addDroppedImages(
              event.dataTransfer.files,
              pointFromClient(event.clientX, event.clientY, event.currentTarget),
            );
          }}
        >
          <canvas
            ref={canvasRef}
            className={cn("block size-full touch-none", mode === "select" ? "cursor-move" : "cursor-crosshair")}
            aria-label="Idea canvas"
            onPointerDown={beginStroke}
            onPointerMove={moveStroke}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={(event) => {
              if (activeStrokeRef.current) {
                endStroke(event);
              }
            }}
          />
          {dragActive && (
            <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-lg border border-dashed border-ring bg-background/70 text-base text-muted-foreground backdrop-blur-sm">
              Drop images to annotate
            </div>
          )}
        </div>
      </div>
      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-base text-muted-foreground">
        <span>Canvas</span>
        <span className="truncate">
          Drop images, resize them, add shapes or pencil notes, then attach the PNG to the prompt.
        </span>
      </div>
    </div>
  );
}

function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>): Point {
  return pointFromClient(event.clientX, event.clientY, event.currentTarget);
}

function isShapeTool(tool: CanvasTool): tool is CanvasShapeKind {
  return tool === "rectangle" || tool === "ellipse" || tool === "line";
}

function orderedMarks(
  shapes: CanvasShape[],
  strokes: Stroke[],
): Array<{ type: "shape"; value: CanvasShape; order: number } | { type: "stroke"; value: Stroke; order: number }> {
  return [
    ...shapes.map((shape) => ({ type: "shape" as const, value: shape, order: shape.order })),
    ...strokes.map((stroke) => ({ type: "stroke" as const, value: stroke, order: stroke.order })),
  ].sort((left, right) => left.order - right.order);
}
