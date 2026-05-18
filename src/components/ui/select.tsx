import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between gap-2 rounded-md bg-transparent px-2.5 text-sm text-muted-foreground outline-none hover:bg-accent focus:ring-2 focus:ring-ring",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon>
      <ChevronDown data-icon="inline-end" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));

SelectTrigger.displayName = "SelectTrigger";

type SelectContentProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Popup> & {
  align?: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Positioner>["align"];
  position?: "popper" | "item-aligned";
  side?: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Positioner>["side"];
  sideOffset?: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Positioner>["sideOffset"];
};

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Popup>,
  SelectContentProps
>(({ align = "start", className, children, position: _position, side, sideOffset = 6, ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Positioner align={align} side={side} sideOffset={sideOffset} className="z-[100]">
      <SelectPrimitive.Popup
        ref={ref}
        className={cn("min-w-48 overflow-hidden rounded-md border border-border bg-popover shadow-md outline-none", className)}
        {...props}
      >
        <SelectPrimitive.List className="p-1">{children}</SelectPrimitive.List>
      </SelectPrimitive.Popup>
    </SelectPrimitive.Positioner>
  </SelectPrimitive.Portal>
));

SelectContent.displayName = "SelectContent";

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn("relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent", className)}
    {...props}
  >
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-3.5" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));

SelectItem.displayName = "SelectItem";
