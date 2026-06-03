import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & {
  ref?: React.Ref<React.ElementRef<typeof SelectPrimitive.Trigger>>;
}): React.JSX.Element {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex h-10 w-full items-center justify-between gap-2 rounded-md bg-transparent px-2.5 text-base text-muted-foreground outline-none hover:bg-accent focus:ring-2 focus:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown data-icon="inline-end" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

type SelectContentProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Popup> & {
  align?: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Positioner>["align"];
  position?: "popper" | "item-aligned";
  side?: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Positioner>["side"];
  sideOffset?: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Positioner>["sideOffset"];
};

export function SelectContent({
  align = "start",
  className,
  children,
  position: _position,
  ref,
  side,
  sideOffset = 6,
  ...props
}: SelectContentProps & { ref?: React.Ref<React.ElementRef<typeof SelectPrimitive.Popup>> }): React.JSX.Element {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner align={align} side={side} sideOffset={sideOffset} className="z-[100]">
        <SelectPrimitive.Popup
          ref={ref}
          className={cn(
            "min-w-48 overflow-hidden rounded-md bg-popover shadow-md ring-1 ring-foreground/10 outline-none",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.List className="p-1">{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & {
  ref?: React.Ref<React.ElementRef<typeof SelectPrimitive.Item>>;
}): React.JSX.Element {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-base outline-none focus:bg-accent",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
