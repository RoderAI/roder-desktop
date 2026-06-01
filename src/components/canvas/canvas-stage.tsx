import type React from "react";
import type { RefObject } from "react";
import { pointFromClient, type CanvasTool, type Point } from "@/lib/canvas-surface";
import { cn } from "@/lib/utils";

type CanvasStageProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  dragActive: boolean;
  mode: CanvasTool;
  toolbar: React.ReactNode;
  wrapperRef: RefObject<HTMLDivElement | null>;
  onBeginStroke: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onDropImages: (files: FileList, point: Point) => void;
  onEndStroke: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onMoveStroke: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerLeave: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  onSetDragActive: (active: boolean) => void;
};

export function CanvasStage({
  canvasRef,
  dragActive,
  mode,
  toolbar,
  wrapperRef,
  onBeginStroke,
  onDropImages,
  onEndStroke,
  onMoveStroke,
  onPointerLeave,
  onSetDragActive,
}: CanvasStageProps): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 p-3">
      <div
        ref={wrapperRef}
        className={cn(
          "relative h-full overflow-hidden rounded-lg border border-border bg-white shadow-inner",
          dragActive && "ring-2 ring-ring",
        )}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            onSetDragActive(true);
          }
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            onSetDragActive(false);
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
          onSetDragActive(false);
          onDropImages(event.dataTransfer.files, pointFromClient(event.clientX, event.clientY, event.currentTarget));
        }}
      >
        <canvas
          ref={canvasRef}
          className={cn("block size-full touch-none", mode === "select" ? "cursor-move" : "cursor-crosshair")}
          aria-label="Idea canvas"
          onPointerDown={onBeginStroke}
          onPointerMove={onMoveStroke}
          onPointerUp={onEndStroke}
          onPointerCancel={onEndStroke}
          onPointerLeave={onPointerLeave}
        />
        <div className="pointer-events-none absolute inset-x-2 bottom-3 flex justify-center">
          <div className="pointer-events-auto max-w-full transition motion-reduce:transition-none">{toolbar}</div>
        </div>
        {dragActive && (
          <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-lg border border-dashed border-ring bg-white/80 text-base text-muted-foreground backdrop-blur-sm">
            Drop images
          </div>
        )}
      </div>
    </div>
  );
}
