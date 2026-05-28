import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

type TooltipProviderProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider> & {
  delayDuration?: number;
};

export function TooltipProvider({ delayDuration, delay, ...props }: TooltipProviderProps): React.JSX.Element {
  return <TooltipPrimitive.Provider delay={delay ?? delayDuration} {...props} />;
}

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Popup>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Popup> & {
    align?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Positioner>["align"];
    side?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Positioner>["side"];
    sideOffset?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Positioner>["sideOffset"];
  }
>(({ align, className, side, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Positioner align={align} side={side} sideOffset={sideOffset} className="z-50">
      <TooltipPrimitive.Popup
        ref={ref}
        className={cn(
          "rounded-md bg-primary px-2 py-1 text-base text-primary-foreground shadow-md outline-none",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Positioner>
  </TooltipPrimitive.Portal>
));

TooltipContent.displayName = "TooltipContent";
