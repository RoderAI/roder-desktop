import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

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
      <Menu.Positioner align={align} side={side} sideOffset={sideOffset} className="z-50">
        <Menu.Popup
          ref={ref}
          className={cn(
            "min-w-40 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none",
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
});

type DropdownMenuItemProps = Omit<React.ComponentPropsWithoutRef<typeof Menu.Item>, "onSelect"> & {
  onSelect?: (event: React.MouseEvent<HTMLElement>) => void;
};

export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof Menu.Item>, DropdownMenuItemProps>(function DropdownMenuItem({
  className,
  onClick,
  onSelect,
  ...props
}, ref) {
  return (
    <Menu.Item
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent",
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
