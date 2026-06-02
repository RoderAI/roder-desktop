import * as React from "react";
import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { cn } from "@/lib/utils";
import { dropdownMenuContentClassName, dropdownMenuItemClassName } from "@/components/ui/dropdown-menu";

export const ContextMenu = BaseContextMenu.Root;
export const ContextMenuTrigger = BaseContextMenu.Trigger;
export const ContextMenuGroup = BaseContextMenu.Group;

type ContextMenuContentProps = React.ComponentPropsWithoutRef<typeof BaseContextMenu.Popup> & {
  align?: React.ComponentPropsWithoutRef<typeof BaseContextMenu.Positioner>["align"];
  side?: React.ComponentPropsWithoutRef<typeof BaseContextMenu.Positioner>["side"];
  sideOffset?: React.ComponentPropsWithoutRef<typeof BaseContextMenu.Positioner>["sideOffset"];
};

export function ContextMenuContent({
  align = "start",
  className,
  ref,
  side,
  sideOffset = 6,
  ...props
}: ContextMenuContentProps & { ref?: React.Ref<React.ElementRef<typeof BaseContextMenu.Popup>> }): React.JSX.Element {
  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner align={align} side={side} sideOffset={sideOffset} className="z-[100]">
        <BaseContextMenu.Popup ref={ref} className={cn(dropdownMenuContentClassName, className)} {...props} />
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  );
}

type ContextMenuItemProps = Omit<React.ComponentPropsWithoutRef<typeof BaseContextMenu.Item>, "onSelect"> & {
  onSelect?: (event: React.MouseEvent<HTMLElement>) => void;
  selected?: boolean;
};

export function ContextMenuItem({
  className,
  onClick,
  onSelect,
  ref,
  selected,
  ...props
}: ContextMenuItemProps & { ref?: React.Ref<React.ElementRef<typeof BaseContextMenu.Item>> }): React.JSX.Element {
  return (
    <BaseContextMenu.Item
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
