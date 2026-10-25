import {
  BookOpen,
  Check,
  FileText,
  FileUp,
  ImageIcon,
  Network,
  PencilLine,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Combobox } from "@base-ui/react/combobox";
import { useState } from "react";
import type {
  DesktopAttachment,
  InferenceRoutingOptionDescriptor,
  ModelSelectionMode,
  PolicyMode,
  ReasoningEffort,
  RoderModel,
} from "@/types/roder";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownTriggerChevron,
  dropdownMenuContentClassName,
  dropdownMenuItemClassName,
  dropdownMenuTriggerVariants,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ProviderLogo } from "@/components/provider-logo";
import { groupModelsByProvider, providerName, reasoningEffortsFor, resolveReasoningEffort } from "@/lib/roder-models";
import { cn } from "@/lib/utils";

export const pickerMenuSurfaceClassName = "bg-card text-card-foreground ring-border/70";

export function PolicyModePicker({
  selectedMode,
  onChange,
}: {
  selectedMode: PolicyMode;
  onChange: (mode: PolicyMode) => void;
}): React.JSX.Element {
  const selected = policyModeOptions.find((option) => option.mode === selectedMode) ?? policyModeOptions[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        variant="pill"
        className="max-w-40 px-2.5 text-base text-muted-foreground sm:max-w-none sm:px-3"
        aria-label={`Choose permission mode: ${selected.label}`}
      >
        <ShieldCheck className="size-4 shrink-0" />
        <span className="truncate">{selected.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-64">
        <DropdownMenuGroup>
          {policyModeOptions.map((option) => (
            <DropdownMenuItem
              key={option.mode}
              selected={option.mode === selected.mode}
              className="items-start gap-2 py-2"
              onSelect={() => onChange(option.mode)}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-foreground">{option.label}</div>
                <div className="mt-0.5 text-sm leading-5 text-muted-foreground">{option.description}</div>
              </div>
              {option.mode === selected.mode && <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const policyModeOptions: Array<{
  mode: PolicyMode;
  label: string;
  description: string;
}> = [
  {
    mode: "accept_all",
    label: "Accept all",
    description: "Run edits and commands without stopping for approval.",
  },
  {
    mode: "default",
    label: "Ask before changes",
    description: "Pause before writes, commands, and other side effects.",
  },
  {
    mode: "plan",
    label: "Plan only",
    description: "Read and reason while blocking edits and commands.",
  },
  {
    mode: "bypass",
    label: "Full access",
    description: "Auto-approve every tool the harness allows.",
  },
];

export function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: DesktopAttachment;
  onRemove: () => void;
}): React.JSX.Element {
  const isImage = attachment.type.startsWith("image/");
  const canPreviewImage = isImage && Boolean(attachment.imageUrl);
  return (
    <span className="flex max-w-56 items-center gap-2 rounded-xl bg-muted px-2.5 py-1.5 text-base text-muted-foreground">
      {canPreviewImage ? (
        <img
          src={attachment.imageUrl}
          alt={attachment.name}
          className="size-9 shrink-0 rounded-md border border-border bg-background object-cover"
        />
      ) : isImage ? (
        <ImageIcon className="size-4 shrink-0" />
      ) : (
        <FileText className="size-4 shrink-0" />
      )}
      <span className="truncate">{attachment.name}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={`Remove ${attachment.name}`}
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </span>
  );
}

export function ComposerAttachMenuItems({
  onOpenSketch,
  onUploadFile,
}: {
  onOpenSketch: () => void;
  onUploadFile: () => void;
}): React.JSX.Element {
  return (
    <>
      <DropdownMenuItem className="h-9" onSelect={onUploadFile}>
        <FileUp className="size-4 shrink-0" />
        <span>Upload file</span>
      </DropdownMenuItem>
      <DropdownMenuItem className="h-9" onSelect={onOpenSketch}>
        <PencilLine className="size-4 shrink-0" />
        <span>Sketch</span>
      </DropdownMenuItem>
    </>
  );
}

export function ComposerSkillsMenuItem({ onSelect }: { onSelect: () => void }): React.JSX.Element {
  return (
    <DropdownMenuItem className="h-9 justify-between gap-3" onSelect={onSelect}>
      <span className="flex min-w-0 items-center gap-2">
        <BookOpen className="size-4 shrink-0" />
        <span>Skills</span>
      </span>
      <span className="ml-auto shrink-0 text-sm text-muted-foreground">$</span>
    </DropdownMenuItem>
  );
}

export function ComposerMcpServersMenuItem({ onSelect }: { onSelect: () => void }): React.JSX.Element {
  return (
    <DropdownMenuItem className="h-9 justify-between gap-3" onSelect={onSelect}>
      <span className="flex min-w-0 items-center gap-2">
        <Server className="size-4 shrink-0" />
        <span>MCP servers</span>
      </span>
      <span className="ml-auto shrink-0 text-sm text-muted-foreground">@</span>
    </DropdownMenuItem>
  );
}

export function ComposerPlanModeMenuItem({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <DropdownMenuItem className="h-9 justify-between" selected={enabled} onSelect={onToggle}>
      <span className="flex min-w-0 items-center gap-2">
        <ShieldCheck className="size-4 shrink-0" />
        <span>Plan mode</span>
      </span>
      {enabled && <Check className="size-3.5 shrink-0 text-primary" />}
    </DropdownMenuItem>
  );
}

export function ComposerAgentSwarmModeMenuItem({
  enabled,
  available,
  onToggle,
}: {
  enabled: boolean;
  available: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <DropdownMenuItem
      className="h-9 justify-between"
      selected={enabled}
      disabled={!available}
      title={
        available
          ? "Route suitable work through agent_swarm fanout"
          : "Update the bundled Roder binary to use Agent Swarm mode"
      }
      onSelect={onToggle}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Network className="size-4 shrink-0" />
        <span>Agent Swarm</span>
      </span>
      {enabled && <Check className="size-3.5 shrink-0 text-primary" />}
    </DropdownMenuItem>
  );
}

export function ModelPicker({
  models,
  routingOptions,
  selectedModel,
  selectedModelProvider,
  selectedSelectionMode,
  selectedReasoning,
  onChange,
  onAutoChange,
  onReasoningChange,
}: {
  models: RoderModel[];
  routingOptions: InferenceRoutingOptionDescriptor[];
  selectedModel: string;
  selectedModelProvider: string;
  selectedSelectionMode: ModelSelectionMode;
  selectedReasoning: ReasoningEffort;
  onChange: (model: string, provider?: string) => void;
  onAutoChange: (optionId: string) => void;
  onReasoningChange: (reasoning: ReasoningEffort) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const visibleModels: RoderModel[] = models.length > 0 ? models : [];
  const modelItems = visibleModels.map((model): ModelPickerItem => ({ type: "model", model }));
  const autoItems = routingOptions.map((option) => ({ type: "auto" as const, option }));
  const items = [...autoItems, ...modelItems];
  const selectedModelItem =
    visibleModels.find((model) => model.id === selectedModel && model.modelProvider === selectedModelProvider) ??
    visibleModels.find((model) => model.id === selectedModel) ??
    visibleModels[0];
  const selectedAutoItem =
    selectedSelectionMode.type === "auto"
      ? autoItems.find((item) => item.option.id === selectedSelectionMode.optionId)
      : undefined;
  const selected =
    selectedAutoItem ?? (selectedModelItem ? { type: "model" as const, model: selectedModelItem } : null);
  // Efforts come from the selected model, as the engine advertises them. A model that takes none
  // (for example claude-code haiku) shows no effort picker.
  const reasoningChoices = reasoningEffortsFor(selectedModelItem);
  const shownReasoning = resolveReasoningEffort(selectedModelItem, selectedReasoning) ?? selectedReasoning;
  const showReasoningPicker = !selectedAutoItem && reasoningChoices.length > 0;
  const modelGroups = groupModelsByProvider(visibleModels);

  return (
    <div className="flex shrink-0 items-center gap-2 text-foreground">
      <Combobox.Root<ModelPickerItem>
        open={open}
        onOpenChange={setOpen}
        value={selected}
        items={items}
        itemToStringLabel={modelPickerItemName}
        itemToStringValue={modelPickerItemValue}
        isItemEqualToValue={(item, value) => modelPickerItemValue(item) === modelPickerItemValue(value)}
        filter={(item, inputValue) => {
          const haystack = modelPickerItemSearchText(item).toLowerCase();
          return haystack.includes(inputValue.trim().toLowerCase());
        }}
        onValueChange={(item) => {
          if (item?.type === "auto") {
            onAutoChange(item.option.id);
          } else if (item?.type === "model") {
            onChange(item.model.id, item.model.modelProvider);
          }
        }}
      >
        <Combobox.Trigger className={cn(dropdownMenuTriggerVariants({ variant: "pill" }))} aria-label="Choose model">
          <Combobox.Value>
            {(item: ModelPickerItem | null) => <span>{modelPickerLabel(item ?? selected)}</span>}
          </Combobox.Value>
          <DropdownTriggerChevron />
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner align="end" side="top" sideOffset={8} className="z-50">
            <Combobox.Popup
              className={cn(dropdownMenuContentClassName, "w-[320px] p-0", pickerMenuSurfaceClassName)}
              aria-label="Choose model"
            >
              <div className="flex h-11 items-center gap-2.5 border-b border-border px-3.5">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <Combobox.Input
                  className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="Search models"
                />
              </div>
              <Combobox.Empty>
                <div className="px-3.5 py-4 text-base text-muted-foreground">
                  {models.length === 0 ? "Configure a provider in Settings to choose models" : "No matching models"}
                </div>
              </Combobox.Empty>
              <Combobox.List className="max-h-[286px] overflow-y-auto p-1.5">
                {autoItems.length > 0 && (
                  <Combobox.Group items={autoItems}>
                    <Combobox.GroupLabel className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Auto routing
                    </Combobox.GroupLabel>
                    <Combobox.Collection>
                      {(item: ModelPickerItem) => (
                        <Combobox.Item
                          key={modelPickerItemValue(item)}
                          value={item}
                          className={cn(dropdownMenuItemClassName, "h-9 data-[selected]:font-medium")}
                        >
                          <Sparkles className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-foreground">{modelPickerItemName(item)}</span>
                          <Combobox.ItemIndicator
                            keepMounted
                            className="ml-0.5 grid size-3.5 place-items-center text-primary opacity-0 data-[selected]:opacity-100"
                          >
                            <Check className="size-3.5" />
                          </Combobox.ItemIndicator>
                        </Combobox.Item>
                      )}
                    </Combobox.Collection>
                  </Combobox.Group>
                )}
                {modelGroups.map((group) => (
                  <Combobox.Group
                    key={group.provider}
                    items={group.models.map((model): ModelPickerItem => ({ type: "model", model }))}
                  >
                    <Combobox.GroupLabel className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {providerName(group.provider)}
                    </Combobox.GroupLabel>
                    <Combobox.Collection>
                      {(item: ModelPickerItem) => (
                        <Combobox.Item
                          key={modelPickerItemValue(item)}
                          value={item}
                          className={cn(dropdownMenuItemClassName, "h-9 data-[selected]:font-medium")}
                        >
                          {item.type === "model" && <ProviderLogo provider={item.model.modelProvider} />}
                          <span className="min-w-0 flex-1 truncate text-foreground">{modelPickerItemName(item)}</span>
                          <Combobox.ItemIndicator
                            keepMounted
                            className="ml-0.5 grid size-3.5 place-items-center text-primary opacity-0 data-[selected]:opacity-100"
                          >
                            <Check className="size-3.5" />
                          </Combobox.ItemIndicator>
                        </Combobox.Item>
                      )}
                    </Combobox.Collection>
                  </Combobox.Group>
                ))}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {showReasoningPicker && (
        <DropdownMenu>
          <DropdownMenuTrigger variant="pill" aria-label={`Choose thinking effort: ${reasoningLabel(shownReasoning)}`}>
            <span>{reasoningLabel(shownReasoning)}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" sideOffset={8} className={pickerMenuSurfaceClassName}>
            <DropdownMenuGroup>
              {reasoningChoices.map((reasoning) => (
                <DropdownMenuItem
                  key={reasoning}
                  selected={reasoning === shownReasoning}
                  className="h-9 text-base"
                  onSelect={() => onReasoningChange(reasoning)}
                >
                  <span className="min-w-0 flex-1">{reasoningName(reasoning)}</span>
                  {reasoning === shownReasoning && <Check className="size-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

type ModelPickerItem =
  | { type: "auto"; option: InferenceRoutingOptionDescriptor }
  | { type: "model"; model: RoderModel };

function modelPickerItemName(item: ModelPickerItem): string {
  return item.type === "auto" ? item.option.label : modelName(item.model);
}

function modelPickerLabel(item: ModelPickerItem | null): string {
  return item ? modelPickerItemName(item) : "Configure models";
}

function modelPickerItemValue(item: ModelPickerItem): string {
  return item.type === "auto" ? `auto:${item.option.id}` : `model:${item.model.modelProvider}:${item.model.id}`;
}

function modelPickerItemSearchText(item: ModelPickerItem): string {
  if (item.type === "auto") {
    return `${item.option.label} ${item.option.id} ${item.option.routerId} auto`;
  }
  return `${item.model.displayName ?? ""} ${item.model.name} ${item.model.id} ${item.model.modelProvider}`;
}

function modelName(model: RoderModel): string {
  return model.displayName || model.name || model.id;
}

function reasoningLabel(reasoning: ReasoningEffort): string {
  if (reasoning === "medium") {
    return "Med";
  }
  if (reasoning === "xhigh") {
    return "xHigh";
  }
  if (reasoning === "ultra") {
    return "Ultra";
  }
  return reasoning.slice(0, 1).toUpperCase() + reasoning.slice(1);
}

function reasoningName(reasoning: ReasoningEffort): string {
  if (reasoning === "xhigh") {
    return "Extra high";
  }
  if (reasoning === "ultra") {
    return "Ultra";
  }
  return reasoning.slice(0, 1).toUpperCase() + reasoning.slice(1);
}
