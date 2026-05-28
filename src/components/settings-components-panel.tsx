import { Check, Copy, MoreHorizontal, MousePointer2, Pause, Play, Plus, RefreshCw, Settings2, Trash2, Wand2, Zap } from "lucide-react";
import { useEffect, useId, useState, type CSSProperties } from "react";
import {
  type PluginActionState,
  pluginActionButtonVariant,
  pluginActionIcon,
  pluginActionLabel,
  pluginActionStateIsPending,
} from "@/components/plugins/plugin-action";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const buttonVariants: Array<NonNullable<ButtonProps["variant"]>> = ["default", "secondary", "outline", "subtle", "ghost"];
const buttonSizes: Array<NonNullable<ButtonProps["size"]>> = ["default", "sm", "compact", "icon"];
const densityOptions = {
  compact: "Compact",
  comfortable: "Comfortable",
  spacious: "Spacious",
};
const pluginActionStates: PluginActionState[] = ["install", "installing", "uninstall", "uninstalling"];
const pluginActionTimingPresets = {
  snappy: {
    cycleDelayMs: 650,
    iconDurationMs: 120,
    labelDurationMs: 110,
    iconBlurPx: 2,
    labelBlurPx: 1,
    startScale: 0.82,
    overshootScale: 1.02,
    labelOffsetPx: 2,
  },
  balanced: {
    cycleDelayMs: 900,
    iconDurationMs: 180,
    labelDurationMs: 160,
    iconBlurPx: 4,
    labelBlurPx: 2,
    startScale: 0.68,
    overshootScale: 1.08,
    labelOffsetPx: 3,
  },
  expressive: {
    cycleDelayMs: 1200,
    iconDurationMs: 280,
    labelDurationMs: 220,
    iconBlurPx: 8,
    labelBlurPx: 4,
    startScale: 0.52,
    overshootScale: 1.16,
    labelOffsetPx: 6,
  },
};

type PluginActionTimingPreset = keyof typeof pluginActionTimingPresets;

export function ComponentsSettingsPanel(): React.JSX.Element {
  const [density, setDensity] = useState("comfortable");
  const [pluginActionState, setPluginActionState] = useState<PluginActionState>("install");
  const [pluginActionCyclePlaying, setPluginActionCyclePlaying] = useState(false);
  const [pluginActionReplayKey, setPluginActionReplayKey] = useState(0);
  const [pluginActionTiming, setPluginActionTiming] = useState(pluginActionTimingPresets.balanced);

  useEffect(() => {
    if (!pluginActionCyclePlaying) {
      return;
    }
    const interval = window.setInterval(() => {
      setPluginActionState((current) => nextPluginActionState(current));
      setPluginActionReplayKey((key) => key + 1);
    }, pluginActionTiming.cycleDelayMs);

    return () => window.clearInterval(interval);
  }, [pluginActionCyclePlaying, pluginActionTiming.cycleDelayMs]);

  function applyPluginActionPreset(preset: PluginActionTimingPreset): void {
    setPluginActionTiming(pluginActionTimingPresets[preset]);
    setPluginActionReplayKey((key) => key + 1);
  }

  function updatePluginActionTiming<K extends keyof typeof pluginActionTiming>(key: K, value: (typeof pluginActionTiming)[K]): void {
    setPluginActionTiming((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[20px] font-semibold">Components</h1>
        <p className="mt-1 text-base text-muted-foreground">Buttons, menus, and selection controls in the current theme.</p>
      </header>

      <DirectorySection title="Buttons" note="Variants">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {buttonVariants.map((variant) => (
              <Button key={variant} variant={variant}>
                {variantLabel(variant)}
              </Button>
            ))}
          </div>
          <Separator />
          <div className="flex flex-wrap items-center gap-2">
            {buttonSizes.map((size) => (
              <Button key={size} variant="outline" size={size} aria-label={size === "icon" ? "Icon button" : undefined}>
                {size === "icon" ? <Zap /> : sizeLabel(size)}
              </Button>
            ))}
            <Button disabled>
              <Wand2 />
              Disabled
            </Button>
          </div>
        </div>
      </DirectorySection>

      <DirectorySection title="Dropdowns" note="Menus">
        <div className="grid gap-4 md:grid-cols-2">
          <SampleBlock label="Pill trigger">
            <DropdownMenu>
              <DropdownMenuTrigger variant="pill">
                <Settings2 className="size-4" />
                Actions
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuItem selected>
                    <Check className="size-3.5 text-primary" />
                    Selected item
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Copy className="size-3.5" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>Disabled item</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SampleBlock>

          <SampleBlock label="Icon trigger">
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex size-9 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem>
                    <Plus className="size-3.5" />
                    New component
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Settings2 className="size-3.5" />
                    Configure
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive">
                    <Trash2 className="size-3.5" />
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SampleBlock>
        </div>
      </DirectorySection>

      <DirectorySection title="Selects" note="Dropdown controls">
        <div className="grid gap-4 md:grid-cols-2">
          <SampleBlock label="Default">
            <Select items={densityOptions} value={density} onValueChange={(value) => setDensity(value ?? "comfortable")}>
              <SelectTrigger className="w-[220px] border border-border bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="compact">Compact</SelectItem>
                  <SelectItem value="comfortable">Comfortable</SelectItem>
                  <SelectItem value="spacious">Spacious</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </SampleBlock>

          <SampleBlock label="Disabled">
            <Select items={densityOptions} defaultValue="compact" disabled>
              <SelectTrigger className="w-[220px] border border-border bg-card">
                <SelectValue />
              </SelectTrigger>
            </Select>
          </SampleBlock>
        </div>
      </DirectorySection>

      <DirectorySection title="Dialogs" note="Modal surfaces">
        <SampleBlock label="Base UI dialog">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Settings2 />
                Open dialog
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Component settings</DialogTitle>
                <DialogDescription>
                  Dialog content inherits the current theme and base UI text size.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border border-border bg-background px-3 py-3 text-muted-foreground">
                Use dialogs for focused secondary workflows that should not live permanently in the main surface.
              </div>
              <DialogFooter>
                <DialogClose
                  render={(
                    <Button variant="secondary" size="sm">
                      Done
                    </Button>
                  )}
                />
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SampleBlock>
      </DirectorySection>

      <DirectorySection title="Context Menus" note="Right click">
        <ContextMenu>
          <ContextMenuTrigger className="flex min-h-[132px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/45 p-5 text-center outline-none data-[popup-open]:border-primary data-[popup-open]:bg-accent">
            <div className="flex flex-col items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm ring-1 ring-border">
                <MousePointer2 className="size-4" />
              </span>
              <div>
                <div className="text-base font-medium">Context target</div>
                <div className="mt-1 text-base text-muted-foreground">Right-click this area</div>
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuGroup>
              <ContextMenuItem>
                <Copy className="size-3.5" />
                Copy label
              </ContextMenuItem>
              <ContextMenuItem selected>
                <Check className="size-3.5 text-primary" />
                Active state
              </ContextMenuItem>
              <ContextMenuItem className="text-destructive">
                <Trash2 className="size-3.5" />
                Delete sample
              </ContextMenuItem>
            </ContextMenuGroup>
          </ContextMenuContent>
        </ContextMenu>
      </DirectorySection>

      <DirectorySection title="Plugin action motion" note="Install states">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex min-h-56 flex-col items-center justify-center gap-5 rounded-lg border border-border bg-background p-5">
            <Button
              variant={pluginActionButtonVariant(pluginActionState)}
              size="sm"
              className={cn("w-40 transition-none", pluginActionStateIsPending(pluginActionState) && "plugin-action-button-pending")}
            >
              <PluginActionDemoContent
                replayKey={pluginActionReplayKey}
                state={pluginActionState}
                timing={pluginActionTiming}
              />
            </Button>
            <div className="flex flex-wrap justify-center gap-2">
              {pluginActionStates.map((state) => (
                <Button
                  key={state}
                  variant={pluginActionState === state ? "secondary" : "outline"}
                  size="compact"
                  onClick={() => {
                    setPluginActionCyclePlaying(false);
                    setPluginActionState(state);
                    setPluginActionReplayKey((key) => key + 1);
                  }}
                >
                  {pluginActionLabel(state)}
                </Button>
              ))}
              <Button
                variant={pluginActionCyclePlaying ? "secondary" : "outline"}
                size="compact"
                onClick={() => {
                  if (!pluginActionCyclePlaying) {
                    setPluginActionState("install");
                    setPluginActionReplayKey((key) => key + 1);
                  }
                  setPluginActionCyclePlaying((playing) => !playing);
                }}
              >
                {pluginActionCyclePlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                {pluginActionCyclePlaying ? "Stop" : "Cycle"}
              </Button>
              <Button variant="ghost" size="compact" onClick={() => setPluginActionReplayKey((key) => key + 1)}>
                <RefreshCw className="size-3.5" />
                Replay
              </Button>
            </div>
          </div>

          <div className="grid gap-4">
            <SampleBlock label="Timing presets">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(pluginActionTimingPresets) as PluginActionTimingPreset[]).map((preset) => (
                  <Button key={preset} variant="outline" size="compact" onClick={() => applyPluginActionPreset(preset)}>
                    {capitalizeLabel(preset)}
                  </Button>
                ))}
              </div>
            </SampleBlock>
            <SampleBlock label="Tuning">
              <div className="grid w-full gap-4">
                <TuningSlider
                  label="Cycle delay"
                  max={1600}
                  min={400}
                  step={50}
                  suffix="ms"
                  value={pluginActionTiming.cycleDelayMs}
                  onChange={(value) => updatePluginActionTiming("cycleDelayMs", value)}
                />
                <TuningSlider
                  label="Icon duration"
                  max={420}
                  min={80}
                  step={10}
                  suffix="ms"
                  value={pluginActionTiming.iconDurationMs}
                  onChange={(value) => updatePluginActionTiming("iconDurationMs", value)}
                />
                <TuningSlider
                  label="Label duration"
                  max={360}
                  min={80}
                  step={10}
                  suffix="ms"
                  value={pluginActionTiming.labelDurationMs}
                  onChange={(value) => updatePluginActionTiming("labelDurationMs", value)}
                />
                <TuningSlider
                  label="Icon blur"
                  max={12}
                  min={0}
                  step={1}
                  suffix="px"
                  value={pluginActionTiming.iconBlurPx}
                  onChange={(value) => updatePluginActionTiming("iconBlurPx", value)}
                />
                <TuningSlider
                  label="Start scale"
                  max={0.95}
                  min={0.4}
                  step={0.01}
                  value={pluginActionTiming.startScale}
                  onChange={(value) => updatePluginActionTiming("startScale", value)}
                />
                <TuningSlider
                  label="Overshoot"
                  max={1.24}
                  min={1}
                  step={0.01}
                  value={pluginActionTiming.overshootScale}
                  onChange={(value) => updatePluginActionTiming("overshootScale", value)}
                />
                <TuningSlider
                  label="Label drift"
                  max={10}
                  min={0}
                  step={1}
                  suffix="px"
                  value={pluginActionTiming.labelOffsetPx}
                  onChange={(value) => updatePluginActionTiming("labelOffsetPx", value)}
                />
              </div>
            </SampleBlock>
          </div>
        </div>
      </DirectorySection>
    </div>
  );
}

function DirectorySection({ children, note, title }: { children: React.ReactNode; note: string; title: string }): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <h2 className="text-base font-medium">{title}</h2>
        <Badge variant="muted">{note}</Badge>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function SampleBlock({ children, label }: { children: React.ReactNode; label: string }): React.JSX.Element {
  return (
    <div className="flex min-h-24 flex-col justify-between gap-4 rounded-lg border border-border bg-background p-4">
      <div className="text-base text-muted-foreground">{label}</div>
      <div className="flex min-h-10 items-center">{children}</div>
    </div>
  );
}

function PluginActionDemoContent({
  replayKey,
  state,
  timing,
}: {
  replayKey: number;
  state: PluginActionState;
  timing: typeof pluginActionTimingPresets.balanced;
}): React.JSX.Element {
  const style = {
    "--plugin-action-icon-duration": `${timing.iconDurationMs}ms`,
    "--plugin-action-icon-blur": `${timing.iconBlurPx}px`,
    "--plugin-action-icon-start-scale": timing.startScale,
    "--plugin-action-icon-overshoot-scale": timing.overshootScale,
    "--plugin-action-label-duration": `${timing.labelDurationMs}ms`,
    "--plugin-action-label-blur": `${timing.labelBlurPx}px`,
    "--plugin-action-label-y": `${timing.labelOffsetPx}px`,
  } as PluginActionDemoStyle;

  return (
    <span className="contents" style={style}>
      <span className="plugin-action-icon-slot" aria-hidden="true">
        <span key={`icon:${state}:${replayKey}`} className="plugin-action-icon" data-animate="true">
          {pluginActionIcon(state)}
        </span>
      </span>
      <span className="plugin-action-label-slot">
        <span key={`label:${state}:${replayKey}`} className="plugin-action-label min-w-0 truncate" data-animate="true">
          {pluginActionLabel(state)}
        </span>
      </span>
    </span>
  );
}

function TuningSlider({
  label,
  max,
  min,
  onChange,
  step,
  suffix = "",
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  suffix?: string;
  value: number;
}): React.JSX.Element {
  const inputId = useId();

  return (
    <div className="grid gap-2">
      <label className="flex items-center justify-between gap-3 text-base" htmlFor={inputId}>
        <span className="font-medium">{label}</span>
        <span className="font-mono text-muted-foreground">{formatSliderValue(value)}{suffix}</span>
      </label>
      <input
        id={inputId}
        className="h-2 w-full accent-foreground"
        max={max}
        min={min}
        step={step}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}

type PluginActionDemoStyle = CSSProperties & {
  "--plugin-action-icon-duration": string;
  "--plugin-action-icon-blur": string;
  "--plugin-action-icon-start-scale": number;
  "--plugin-action-icon-overshoot-scale": number;
  "--plugin-action-label-duration": string;
  "--plugin-action-label-blur": string;
  "--plugin-action-label-y": string;
};

function nextPluginActionState(current: PluginActionState): PluginActionState {
  const currentIndex = pluginActionStates.indexOf(current);
  return pluginActionStates[(currentIndex + 1) % pluginActionStates.length] ?? pluginActionStates[0];
}

function formatSliderValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function variantLabel(variant: NonNullable<ButtonProps["variant"]>): string {
  return variant.slice(0, 1).toUpperCase() + variant.slice(1);
}

function capitalizeLabel(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function sizeLabel(size: NonNullable<ButtonProps["size"]>): string {
  switch (size) {
    case "sm":
      return "Small";
    case "compact":
      return "Compact";
    default:
      return "Default";
  }
}
