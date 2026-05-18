import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuGroup = Menu.Group;
export const dropdownMenuContentClassName =
  "dropdown-menu-popup min-w-40 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-md outline-none";
export const dropdownMenuItemClassName =
  "relative flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent";

export const dropdownMenuTriggerVariants = cva("outline-none disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-ring", {
  variants: {
    variant: {
      unstyled: "",
      pill: "group inline-flex h-8 items-center justify-center gap-2 rounded-full bg-card/70 px-3 font-medium text-foreground shadow-sm ring-1 ring-border transition-colors hover:bg-card data-[popup-open]:bg-card",
    },
  },
  defaultVariants: {
    variant: "unstyled",
  },
});

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

export const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, DropdownMenuTriggerProps>(
  ({ children, className, showChevron, variant, ...props }, ref) => {
    const shouldShowChevron = showChevron ?? variant === "pill";

    return (
      <Menu.Trigger ref={ref} className={cn(dropdownMenuTriggerVariants({ variant }), className)} {...props}>
        {children}
        {shouldShowChevron && <DropdownTriggerChevron />}
      </Menu.Trigger>
    );
  },
);

DropdownMenuTrigger.displayName = "DropdownMenuTrigger";

type DropdownMenuContentProps = React.ComponentPropsWithoutRef<typeof Menu.Popup> & {
  align?: React.ComponentPropsWithoutRef<typeof Menu.Positioner>["align"];
  side?: React.ComponentPropsWithoutRef<typeof Menu.Positioner>["side"];
  sideOffset?: React.ComponentPropsWithoutRef<typeof Menu.Positioner>["sideOffset"];
};

export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof Menu.Popup>, DropdownMenuContentProps>(function DropdownMenuContent({
  align = "start",
  className,
  side,
  sideOffset = 6,
  ...props
}, ref) {
  return (
    <Menu.Portal>
      <Menu.Positioner align={align} side={side} sideOffset={sideOffset} className="z-[100]">
        <Menu.Popup
          ref={ref}
          className={cn(dropdownMenuContentClassName, className)}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
});

type DropdownMenuItemProps = Omit<React.ComponentPropsWithoutRef<typeof Menu.Item>, "onSelect"> & {
  onSelect?: (event: React.MouseEvent<HTMLElement>) => void;
  selected?: boolean;
};

export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof Menu.Item>, DropdownMenuItemProps>(function DropdownMenuItem({
  className,
  onClick,
  onSelect,
  selected,
  ...props
}, ref) {
  return (
    <Menu.Item
      ref={ref}
      aria-selected={selected || undefined}
      className={cn(
        dropdownMenuItemClassName,
        selected && "font-medium",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onSelect?.(event);
        }
      }}
      {...props}
    />
  );
});
