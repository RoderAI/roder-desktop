import { ArrowDown, Check, ChevronDown, FileText, ImageIcon, Plus, Search, X } from "lucide-react";
import { useRef, useState } from "react";
import type { DesktopAttachment, GodeModel, GodeThread, ReasoningEffort, WorkspaceFolder } from "@/types/gode";
import { Button, buttonVariants } from "@/components/ui/button";
import { WorkspacePicker } from "@/components/workspace-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ComposerProps = {
  busy: boolean;
  models: GodeModel[];
  selectedModel: string;
  selectedReasoning: ReasoningEffort;
  selectedWorkspaceCwd: string;
  statusCwd?: string;
  workspaceRecents: WorkspaceFolder[];
  threads: GodeThread[];
  attachments: DesktopAttachment[];
  onSelectedModelChange: (model: string) => void;
  onCycleReasoning: () => void;
  onWorkspaceSelect: (cwd: string) => void;
  onOpenWorkspaceFolder: () => void;
  onScrollToBottom: () => void;
  onAttachmentsChange: (attachments: DesktopAttachment[]) => void;
  onSend: (prompt: string, attachments: DesktopAttachment[]) => Promise<void>;
};

export function Composer({
  busy,
  models,
  selectedModel,
  selectedReasoning,
  selectedWorkspaceCwd,
  statusCwd,
  workspaceRecents,
  threads,
  attachments,
  onSelectedModelChange,
  onCycleReasoning,
  onWorkspaceSelect,
  onOpenWorkspaceFolder,
  onScrollToBottom,
  onAttachmentsChange,
  onSend,
}: ComposerProps): React.JSX.Element {
  const [prompt, setPrompt] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function submit(): Promise<void> {
    const value = prompt.trim();
    if ((!value && attachments.length === 0) || busy) {
      return;
    }
    const submittedAttachments = attachments;
    setPrompt("");
    onAttachmentsChange([]);
    await onSend(value, submittedAttachments);
  }

  function addAttachments(nextAttachments: DesktopAttachment[]): void {
    const seen = new Set(attachments.map((attachment) => attachment.path));
    onAttachmentsChange([
      ...attachments,
      ...nextAttachments
        .filter((attachment) => attachment.path && !seen.has(attachment.path))
        .map((attachment) => ({ ...attachment, id: attachment.id || crypto.randomUUID() })),
    ]);
  }

  function removeAttachment(id: string): void {
    onAttachmentsChange(attachments.filter((attachment) => attachment.id !== id));
  }

  function attachFiles(files: FileList | File[]): void {
    const resolved = window.godeDesktop
      .resolveDroppedFiles(Array.from(files))
      .map((file) => ({ ...file, id: crypto.randomUUID() }));
    addAttachments(resolved);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files.length > 0) {
      attachFiles(event.dataTransfer.files);
    }
  }

  return (
    <div
      className="mx-auto w-full max-w-[980px] px-8 pb-5 pt-2"
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
        }
      }}
      onDrop={handleDrop}
    >
      <div className="mb-3 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(buttonVariants({ variant: "subtle", size: "compact" }), "rounded-full px-3 text-muted-foreground")}>
              Commit
              <ChevronDown className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuItem>Commit current patch</DropdownMenuItem>
                <DropdownMenuItem>Create branch</DropdownMenuItem>
                <DropdownMenuItem>Open diff</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="icon"
            className="size-8 rounded-full text-muted-foreground"
            aria-label="Scroll to bottom"
            onClick={onScrollToBottom}
          >
            <ArrowDown className="size-4" />
          </Button>
        </div>
        <WorkspacePicker
          selectedCwd={selectedWorkspaceCwd}
          statusCwd={statusCwd}
          recents={workspaceRecents}
          threads={threads}
          onSelect={onWorkspaceSelect}
          onOpenFolder={onOpenWorkspaceFolder}
        />
        <div />
      </div>
      <div className={cn("rounded-[18px] bg-card shadow-sm ring-1 ring-border transition-colors", dragActive && "ring-2 ring-ring")}>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
            {attachments.map((attachment) => (
              <AttachmentChip key={attachment.id} attachment={attachment} onRemove={() => removeAttachment(attachment.id)} />
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 px-3 py-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.currentTarget.files) {
                attachFiles(event.currentTarget.files);
              }
              event.currentTarget.value = "";
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 rounded-full text-muted-foreground"
            aria-label="Attach files"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus className="size-5" />
          </Button>
          <Textarea
            value={prompt}
            placeholder="Send follow-up"
            disabled={busy}
            className="max-h-36 min-h-[44px] border-0 bg-transparent px-1 py-2 text-[16px] shadow-none ring-0 focus-visible:ring-0"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <ModelPicker
            models={models}
            selectedModel={selectedModel}
            selectedReasoning={selectedReasoning}
            onChange={onSelectedModelChange}
            onCycleReasoning={onCycleReasoning}
          />
        </div>
      </div>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: DesktopAttachment;
  onRemove: () => void;
}): React.JSX.Element {
  const isImage = attachment.type.startsWith("image/");
  return (
    <span className="flex max-w-[220px] items-center gap-2 rounded-full bg-muted px-3 py-1 text-[13px] text-muted-foreground">
      {isImage ? <ImageIcon className="size-4 shrink-0" /> : <FileText className="size-4 shrink-0" />}
      <span className="truncate">{attachment.name}</span>
      <button
        type="button"
        className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={`Remove ${attachment.name}`}
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

function ModelPicker({
  models,
  selectedModel,
  selectedReasoning,
  onChange,
  onCycleReasoning,
}: {
  models: GodeModel[];
  selectedModel: string;
  selectedReasoning: ReasoningEffort;
  onChange: (model: string) => void;
  onCycleReasoning: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const visibleModels = models.length > 0 ? models : [{ id: selectedModel, name: "Codex 5.3", modelProvider: "codex" }];
  const selected = visibleModels.find((model) => model.id === selectedModel) ?? visibleModels[0];
  const filteredModels = visibleModels
    .filter((model) => {
      const haystack = `${model.name} ${model.id} ${model.modelProvider}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    })
    .slice(0, 10);

  return (
    <div className="flex h-10 shrink-0 items-center overflow-hidden rounded-xl bg-muted/65 text-foreground">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="group flex h-full min-w-[138px] items-center px-4 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Choose model"
        >
          <span className="relative max-w-[112px] truncate text-[15px] font-medium leading-none">
            {modelName(selected)}
            <span className="absolute -bottom-1.5 left-0 h-0.5 w-full rounded-full bg-fuchsia-400" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-[320px] rounded-xl p-0">
          <div className="flex h-11 items-center gap-2.5 border-b border-border px-3.5">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
              placeholder="Search models"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
          <div className="max-h-[286px] overflow-y-auto p-1.5">
            {filteredModels.length > 0 ? (
              filteredModels.map((model) => (
                <DropdownMenuItem
                  key={model.id}
                  className={cn(
                    "h-9 rounded-lg px-2 text-[14px] focus:bg-accent",
                    model.id === selectedModel && "bg-accent/80",
                  )}
                  onSelect={() => onChange(model.id)}
                >
                  <ProviderMark provider={model.modelProvider} />
                  <span className="min-w-0 flex-1 truncate text-foreground">{modelName(model)}</span>
                  <span className="max-w-[76px] truncate text-[13px] text-muted-foreground">{providerName(model.modelProvider)}</span>
                  {model.id === selectedModel && <Check className="ml-0.5 size-3.5 text-fuchsia-300" />}
                </DropdownMenuItem>
              ))
            ) : (
              <div className="px-2 py-4 text-[13px] text-muted-foreground">No matching models</div>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        className="flex h-full items-center gap-2 px-3 text-[15px] text-muted-foreground outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Reasoning effort ${reasoningLabel(selectedReasoning)}. Click to increase.`}
        onClick={onCycleReasoning}
      >
        <span className="min-w-8 text-left">{reasoningLabel(selectedReasoning)}</span>
        <ReasoningBars reasoning={selectedReasoning} />
      </button>
    </div>
  );
}

function ReasoningBars({ reasoning }: { reasoning: ReasoningEffort }): React.JSX.Element {
  const activeBars = reasoningBarCount(reasoning);
  const barHeights = [5, 8, 11, 14];

  return (
    <span className="flex h-4 w-5 shrink-0 items-end justify-end gap-0.5" aria-hidden="true">
      {barHeights.map((height, index) => {
        const active = index < activeBars;
        return (
          <span
            key={height}
            className={cn(
              "w-0.5 rounded-full transition-all duration-200 ease-out",
              active ? "bg-foreground" : "bg-foreground/20",
            )}
            style={{ height }}
          />
        );
      })}
    </span>
  );
}

function ProviderMark({ provider }: { provider: string }): React.JSX.Element {
  const label = providerName(provider).slice(0, 1).toUpperCase();
  return (
    <span
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
        provider.toLowerCase().includes("openai") ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground",
      )}
    >
      {label || "G"}
    </span>
  );
}

function modelName(model: GodeModel | undefined): string {
  return model?.name || model?.id || "Model";
}

function providerName(provider: string): string {
  if (!provider) {
    return "Gode";
  }
  if (provider.toLowerCase() === "openai") {
    return "OpenAI";
  }
  return provider.slice(0, 1).toUpperCase() + provider.slice(1);
}

function reasoningLabel(reasoning: ReasoningEffort): string {
  if (reasoning === "medium") {
    return "Med";
  }
  if (reasoning === "xhigh") {
    return "xHigh";
  }
  return reasoning.slice(0, 1).toUpperCase() + reasoning.slice(1);
}

function reasoningBarCount(reasoning: ReasoningEffort): number {
  if (reasoning === "low") {
    return 1;
  }
  if (reasoning === "medium") {
    return 2;
  }
  if (reasoning === "high") {
    return 3;
  }
  return 4;
}
