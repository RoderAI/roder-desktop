import {
  Circle,
  Copy,
  Download,
  Frame,
  ImageIcon,
  MessageSquare,
  Minus,
  MousePointer2,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Slash,
  Square,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RoderDesignNode } from "@/types/roder";
import type { DesignViewport, InsertKind } from "./design-canvas-types";

export const DesignToolbar = memo(DesignToolbarImpl);

function DesignToolbarImpl({
  canExport,
  drawKind,
  selectedNode,
  showGrid,
  showRulers,
  snapToGrid,
  undoLabel,
  onAttachRootFrames,
  onAttachSelected,
  onCopySelected,
  onDeleteSelected,
  onDuplicateSelected,
  onDrawKindChange,
  onExportSelected,
  onFitViewport,
  onFitSelected,
  onImportFile,
  onInsert,
  onPasteClipboard,
  onUndo,
  onShowGridChange,
  onShowRulersChange,
  onSnapToGridChange,
  onZoomBy,
  viewport,
}: {
  canExport: boolean;
  drawKind: InsertKind | null;
  selectedNode: RoderDesignNode | null;
  showGrid: boolean;
  showRulers: boolean;
  snapToGrid: boolean;
  undoLabel: string | null;
  onAttachRootFrames: () => Promise<void>;
  onAttachSelected: () => Promise<void>;
  onCopySelected: () => Promise<void>;
  onDeleteSelected: () => Promise<void>;
  onDuplicateSelected: () => Promise<void>;
  onDrawKindChange: (kind: InsertKind | null) => void;
  onExportSelected: () => Promise<void>;
  onFitViewport: () => void;
  onFitSelected: () => void;
  onImportFile: () => void;
  onInsert: (kind: InsertKind) => Promise<void>;
  onPasteClipboard: () => Promise<void>;
  onUndo: () => Promise<void>;
  onShowGridChange: (showGrid: boolean) => void;
  onShowRulersChange: (showRulers: boolean) => void;
  onSnapToGridChange: (snapToGrid: boolean) => void;
  onZoomBy: (delta: number) => void;
  viewport: DesignViewport;
}): React.JSX.Element {
  return (
    <>
      <div className="pointer-events-auto absolute left-3 top-3 z-20 flex flex-col items-center gap-1 rounded-2xl border border-border/80 bg-background/95 p-1.5 shadow-xl shadow-black/10 backdrop-blur">
        <ToolbarButton active={drawKind === null} label="Select" shortcut="V" onClick={() => selectTool(null)}>
          <MousePointer2 className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          active={drawKind === "rectangle"}
          label="Rectangle"
          shortcut="R"
          onClick={() => toggleDrawKind("rectangle")}
        >
          <Square className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          active={drawKind === "ellipse"}
          label="Ellipse"
          shortcut="O"
          onClick={() => toggleDrawKind("ellipse")}
        >
          <Circle className="size-5" />
        </ToolbarButton>
        <ToolbarButton active={drawKind === "line"} label="Line" shortcut="L" onClick={() => toggleDrawKind("line")}>
          <Slash className="size-5" />
        </ToolbarButton>
        <ToolbarButton active={drawKind === "text"} label="Text" shortcut="T" onClick={() => toggleDrawKind("text")}>
          <Type className="size-5" />
        </ToolbarButton>
        <ToolbarButton active={drawKind === "frame"} label="Frame" shortcut="F" onClick={() => toggleDrawKind("frame")}>
          <Frame className="size-5" />
        </ToolbarButton>
        <ToolbarButton active={drawKind === "image"} label="Image" shortcut="I" onClick={() => toggleDrawKind("image")}>
          <ImageIcon className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          active={drawKind === "prompt"}
          label="Agent prompt"
          shortcut="P"
          onClick={() => toggleDrawKind("prompt")}
        >
          <MessageSquare className="size-5" />
        </ToolbarButton>
        <ToolbarButton label="Quick add" shortcut="A" onClick={() => onInsert(drawKind ?? "frame")}>
          <Plus className="size-5" />
        </ToolbarButton>
        <div className="my-1 h-px w-7 bg-border" />
        <ToolbarButton
          active={showGrid}
          label={showGrid ? "Hide grid" : "Show grid"}
          shortcut="G"
          onClick={() => toggleGrid()}
        >
          <SlidersHorizontal className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          active={showRulers}
          label={showRulers ? "Hide rulers" : "Show rulers"}
          shortcut="U"
          onClick={() => toggleRulers()}
        >
          <Minus className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          active={snapToGrid}
          label={snapToGrid ? "Disable snap" : "Enable snap"}
          shortcut="S"
          onClick={() => toggleSnap()}
        >
          <Frame className="size-5" />
        </ToolbarButton>
        <div className="my-1 h-px w-7 bg-border" />
        <ToolbarButton
          disabled={!undoLabel}
          label={undoLabel ? `Undo ${undoLabel}` : "Undo"}
          shortcut="⌘Z"
          onClick={() => onUndo()}
        >
          <RefreshCw className="size-5 -scale-x-100" />
        </ToolbarButton>
        <ToolbarButton disabled={!selectedNode} label="Duplicate" shortcut="⌘D" onClick={() => onDuplicateSelected()}>
          <Copy className="size-5" />
        </ToolbarButton>
        <ToolbarButton disabled={!selectedNode} label="Copy node" shortcut="⌘C" onClick={() => onCopySelected()}>
          <Copy className="size-5" />
        </ToolbarButton>
        <ToolbarButton label="Paste node" shortcut="⌘V" onClick={() => onPasteClipboard()}>
          <Plus className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!selectedNode || !canExport}
          label="Export"
          shortcut="⇧⌘E"
          onClick={() => onExportSelected()}
        >
          <Download className="size-5" />
        </ToolbarButton>
        <ToolbarButton label="Import .pen/JSON" shortcut="⇧⌘I" onClick={() => openImportFile()}>
          <Upload className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!selectedNode || !canExport}
          label="Attach to composer"
          shortcut="⇧⌘A"
          onClick={() => onAttachSelected()}
        >
          <MessageSquare className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!canExport}
          label="Attach all frames"
          shortcut="⌥⇧⌘A"
          onClick={() => onAttachRootFrames()}
        >
          <Frame className="size-5" />
        </ToolbarButton>
        <ToolbarButton disabled={!selectedNode} label="Delete" shortcut="Del" onClick={() => onDeleteSelected()}>
          <Trash2 className="size-5" />
        </ToolbarButton>
        <div className="my-1 h-px w-7 bg-border" />
        <ToolbarButton label="Fit canvas" shortcut="⇧1" onClick={() => Promise.resolve(onFitViewport())}>
          <Frame className="size-5" />
        </ToolbarButton>
        <ToolbarButton
          disabled={!selectedNode}
          label="Fit selected"
          shortcut="⇧2"
          onClick={() => Promise.resolve(onFitSelected())}
        >
          <MousePointer2 className="size-5" />
        </ToolbarButton>
      </div>
      <div className="pointer-events-auto absolute bottom-4 right-4 z-20 flex items-center gap-2 rounded-xl border border-border/80 bg-background/95 p-2 shadow-xl shadow-black/10 backdrop-blur">
        <Button
          variant="ghost"
          size="icon-xs"
          className="rounded-md"
          aria-label="Zoom out"
          onClick={() => onZoomBy(-0.1)}
        >
          <Minus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 min-w-16 rounded-md px-2 font-semibold"
          onClick={onFitViewport}
        >
          {Math.round(viewport.zoom * 100)}%
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="rounded-md"
          aria-label="Zoom in"
          onClick={() => onZoomBy(0.1)}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </>
  );

  function selectTool(kind: InsertKind | null): Promise<void> {
    onDrawKindChange(kind);
    return Promise.resolve();
  }

  function toggleDrawKind(kind: InsertKind): Promise<void> {
    onDrawKindChange(drawKind === kind ? null : kind);
    return Promise.resolve();
  }

  function toggleGrid(): Promise<void> {
    onShowGridChange(!showGrid);
    return Promise.resolve();
  }

  function toggleRulers(): Promise<void> {
    onShowRulersChange(!showRulers);
    return Promise.resolve();
  }

  function toggleSnap(): Promise<void> {
    onSnapToGridChange(!snapToGrid);
    return Promise.resolve();
  }

  function openImportFile(): Promise<void> {
    onImportFile();
    return Promise.resolve();
  }
}

function ToolbarButton({
  active,
  children,
  disabled,
  label,
  onClick,
  shortcut,
}: {
  active?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => Promise<void>;
  shortcut?: string;
}): React.JSX.Element {
  return (
    <div className="group relative">
      <button
        type="button"
        className={cn(
          "grid size-10 place-items-center rounded-xl border text-foreground transition",
          active
            ? "border-border bg-muted text-foreground shadow-sm"
            : "border-transparent bg-transparent hover:border-border/70 hover:bg-background hover:shadow-sm",
          disabled && "cursor-not-allowed opacity-40 hover:border-transparent hover:bg-transparent hover:shadow-none",
        )}
        aria-pressed={active}
        aria-label={label}
        disabled={disabled}
        onClick={() => void onClick()}
      >
        {children}
      </button>
      <div className="pointer-events-none absolute left-[calc(100%+14px)] top-1/2 z-30 hidden -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-lg bg-zinc-950 px-3 py-2 text-sm font-semibold text-white shadow-lg group-hover:flex">
        <span className="absolute -left-1 size-2 rotate-45 bg-zinc-950" />
        <span>{label}</span>
        {shortcut && <kbd className="rounded-md bg-white px-2 py-1 text-xs font-bold text-zinc-900">{shortcut}</kbd>}
      </div>
    </div>
  );
}

