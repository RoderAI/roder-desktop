import { Check, Copy, MoreHorizontal, MousePointer2, Plus, Settings2, Trash2, Wand2, Zap } from "lucide-react";
import { useState } from "react";
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const buttonVariants: Array<NonNullable<ButtonProps["variant"]>> = ["default", "secondary", "outline", "subtle", "ghost"];
const buttonSizes: Array<NonNullable<ButtonProps["size"]>> = ["default", "sm", "compact", "icon"];
const densityOptions = {
  compact: "Compact",
  comfortable: "Comfortable",
  spacious: "Spacious",
};

export function ComponentsSettingsPanel(): React.JSX.Element {
  const [density, setDensity] = useState("comfortable");

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[20px] font-semibold">Components</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">Buttons, menus, and selection controls in the current theme.</p>
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

      <DirectorySection title="Context Menus" note="Right click">
        <ContextMenu>
          <ContextMenuTrigger className="flex min-h-[132px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/45 p-5 text-center outline-none data-[popup-open]:border-primary data-[popup-open]:bg-accent">
            <div className="flex flex-col items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm ring-1 ring-border">
                <MousePointer2 className="size-4" />
              </span>
              <div>
                <div className="text-[14px] font-medium">Context target</div>
                <div className="mt-1 text-[13px] text-muted-foreground">Right-click this area</div>
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
    </div>
  );
}

function DirectorySection({ children, note, title }: { children: React.ReactNode; note: string; title: string }): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <h2 className="text-[15px] font-medium">{title}</h2>
        <Badge variant="muted">{note}</Badge>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function SampleBlock({ children, label }: { children: React.ReactNode; label: string }): React.JSX.Element {
  return (
    <div className="flex min-h-24 flex-col justify-between gap-4 rounded-lg border border-border bg-background p-4">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="flex min-h-10 items-center">{children}</div>
    </div>
  );
}

function variantLabel(variant: NonNullable<ButtonProps["variant"]>): string {
  return variant.slice(0, 1).toUpperCase() + variant.slice(1);
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
