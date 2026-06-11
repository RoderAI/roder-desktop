import { Circle, Eraser, ImagePlus, Minus, MousePointer2, Pencil, RotateCcw, Square, Trash2 } from "lucide-react";
import type React from "react";
import { CanvasToolbarButton as ToolbarButton } from "@/components/canvas-toolbar-button";
import { Button } from "@/components/ui/button";
import type { CanvasTool } from "@/lib/canvas-surface";
import { cn } from "@/lib/utils";

export const canvasDefaultPencilColor = "#18181b";

const swatches = [
  canvasDefaultPencilColor,
  "#f8f8f2",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#38bdf8",
  "#a78bfa",
  "#f472b6",
];

type CanvasToolbarProps = {
  canUndo: boolean;
  capturing: boolean;
  color: string;
  hasContent: boolean;
  mode: CanvasTool;
  width: number;
  onClear: () => void;
  onColorChange: (color: string) => void;
  onModeChange: (mode: CanvasTool) => void;
  onUndo: () => void;
  onUseSketch: () => Promise<void>;
  onWidthChange: (width: number) => void;
};

export function CanvasToolbar({
  canUndo,
  capturing,
  color,
  hasContent,
  mode,
  width,
  onClear,
  onColorChange,
  onModeChange,
  onUndo,
  onUseSketch,
  onWidthChange,
}: CanvasToolbarProps): React.JSX.Element {
  const selectColor = (nextColor: string) => {
    onColorChange(nextColor);
    onModeChange("draw");
  };

  return (
    <div className="flex max-w-full flex-wrap items-center justify-center gap-1 overflow-visible rounded-2xl bg-card/95 px-2 py-1.5 shadow-lg ring-1 ring-border/70 backdrop-blur-md">
      <ToolbarButton label="Draw" active={mode === "draw"} onClick={() => onModeChange("draw")}>
        <Pencil className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Select and resize images" active={mode === "select"} onClick={() => onModeChange("select")}>
        <MousePointer2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Erase" active={mode === "erase"} onClick={() => onModeChange("erase")}>
        <Eraser className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Rectangle" active={mode === "rectangle"} onClick={() => onModeChange("rectangle")}>
        <Square className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Ellipse" active={mode === "ellipse"} onClick={() => onModeChange("ellipse")}>
        <Circle className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Line" active={mode === "line"} onClick={() => onModeChange("line")}>
        <Minus className="size-4" />
      </ToolbarButton>
      <div className="mx-1 h-5 w-px shrink-0 bg-border" />
      <div className="flex flex-wrap items-center justify-center gap-1">
        {swatches.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={cn(
              "size-5 shrink-0 rounded-full border border-border ring-offset-2 ring-offset-card",
              color === swatch && "ring-2 ring-ring",
            )}
            style={{ backgroundColor: swatch }}
            aria-label={`Use color ${swatch}`}
            title={swatch}
            onClick={() => selectColor(swatch)}
          />
        ))}
        <input
          value={color}
          type="color"
          className="ml-1 size-7 shrink-0 rounded border border-border bg-transparent p-0.5"
          aria-label="Choose drawing color"
          title="Choose drawing color"
          onChange={(event) => selectColor(event.target.value)}
        />
      </div>
      <label className="ml-1 flex items-center gap-2 text-base text-muted-foreground">
        Size
        <input
          value={width}
          type="range"
          aria-label="Drawing size"
          min={2}
          max={18}
          className="w-20 accent-primary sm:w-24"
          onChange={(event) => onWidthChange(Number(event.target.value))}
        />
      </label>
      <div className="mx-1 h-5 w-px shrink-0 bg-border" />
      <ToolbarButton label="Undo mark" disabled={!canUndo} onClick={onUndo}>
        <RotateCcw className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Clear canvas" disabled={!hasContent} onClick={onClear}>
        <Trash2 className="size-4" />
      </ToolbarButton>
      <Button
        size="sm"
        className="h-8 shrink-0 rounded-md px-2.5"
        disabled={!hasContent || capturing}
        onClick={() => void onUseSketch()}
      >
        <ImagePlus className="size-4" />
        <span>Use sketch</span>
      </Button>
    </div>
  );
}
