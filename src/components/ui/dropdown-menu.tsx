import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuCheckboxItem = Menu.CheckboxItem;
export const DropdownMenuCheckboxItemIndicator = Menu.CheckboxItemIndicator;
export const dropdownMenuContentClassName =
  "dropdown-menu-popup min-w-40 overflow-hidden rounded-xl border border-border bg-white p-1.5 text-popover-foreground shadow-md outline-none dark:bg-popover";
export const dropdownMenuItemClassName =
  "relative flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-base outline-none data-[highlighted]:bg-accent";

export const dropdownMenuTriggerVariants = cva(
  "outline-none disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      variant: {
        unstyled: "",
        pill: "group inline-flex h-8 items-center justify-center gap-2 rounded-full bg-card/70 px-3 font-medium text-foreground transition-colors hover:bg-card data-[popup-open]:bg-card",
      },
    },
    defaultVariants: {
      variant: "unstyled",
    },
  },
);

type DropdownMenuTriggerProps = React.ComponentPropsWithoutRef<typeof Menu.Trigger> &
  VariantProps<typeof dropdownMenuTriggerVariants> & {
    showChevron?: boolean;
  };

export function DropdownTriggerChevron({ className }: { className?: string }): React.JSX.Element {
  return (
    <ChevronDown
      className={cn(
        "size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-data-[popup-open]:rotate-180",
        className,
      )}
    />
  );
}

export function DropdownMenuTrigger({
  children,
  className,
  ref,
  showChevron,
  variant,
  ...props
}: DropdownMenuTriggerProps & { ref?: React.Ref<HTMLButtonElement> }): React.JSX.Element {
  const shouldShowChevron = showChevron ?? variant === "pill";

  return (
    <Menu.Trigger ref={ref} className={cn(dropdownMenuTriggerVariants({ variant }), className)} {...props}>
      {children}
      {shouldShowChevron && <DropdownTriggerChevron />}
    </Menu.Trigger>
  );
}

type DropdownMenuContentProps = React.ComponentPropsWithoutRef<typeof Menu.Popup> & {
  align?: React.ComponentPropsWithoutRef<typeof Menu.Positioner>["align"];
  side?: React.ComponentPropsWithoutRef<typeof Menu.Positioner>["side"];
  sideOffset?: React.ComponentPropsWithoutRef<typeof Menu.Positioner>["sideOffset"];
};

export function DropdownMenuContent({
  align = "start",
  className,
  ref,
  side,
  sideOffset = 6,
  ...props
}: DropdownMenuContentProps & { ref?: React.Ref<React.ElementRef<typeof Menu.Popup>> }): React.JSX.Element {
  return (
    <Menu.Portal>
      <Menu.Positioner align={align} side={side} sideOffset={sideOffset} className="z-[100]">
        <Menu.Popup ref={ref} className={cn(dropdownMenuContentClassName, className)} {...props} />
      </Menu.Positioner>
    </Menu.Portal>
  );
}

type DropdownMenuItemProps = Omit<React.ComponentPropsWithoutRef<typeof Menu.Item>, "onSelect"> & {
  onSelect?: (event: React.MouseEvent<HTMLElement>) => void;
  selected?: boolean;
};

export function DropdownMenuItem({
  className,
  onClick,
  onSelect,
  ref,
  selected,
  ...props
}: DropdownMenuItemProps & { ref?: React.Ref<React.ElementRef<typeof Menu.Item>> }): React.JSX.Element {
  return (
    <Menu.Item
      ref={ref}
      aria-selected={selected || undefined}
      className={cn(dropdownMenuItemClassName, selected && "font-medium", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onSelect?.(event);
        }
      }}
      {...props}
    />
  );
}
