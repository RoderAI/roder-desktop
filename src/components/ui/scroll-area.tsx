import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "@/lib/utils";

type ScrollAreaProps = React.HTMLAttributes<HTMLDivElement> & {
  viewportClassName?: string;
  viewportProps?: React.HTMLAttributes<HTMLDivElement>;
  viewportRef?: React.Ref<HTMLDivElement>;
  onViewportScroll?: React.UIEventHandler<HTMLDivElement>;
  hideScrollbar?: boolean;
};

export function ScrollArea({
  className,
  children,
  ref,
  viewportClassName,
  viewportProps,
  viewportRef,
  onViewportScroll,
  hideScrollbar = false,
  ...props
}: ScrollAreaProps & { ref?: React.Ref<HTMLDivElement> }): React.JSX.Element {
  const { className: viewportPropsClassName, ...restViewportProps } = viewportProps ?? {};
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      data-slot="scroll-area"
      className={cn("group/scroll-area relative min-h-0 min-w-0 overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full min-h-0 min-w-0 overscroll-contain rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          viewportClassName,
          viewportPropsClassName,
        )}
        {...restViewportProps}
        onScroll={(event) => {
          restViewportProps.onScroll?.(event);
          onViewportScroll?.(event);
        }}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar hidden={hideScrollbar} />
      <ScrollBar orientation="horizontal" hidden={hideScrollbar} />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({
  className,
  orientation = "vertical",
  children,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar> & {
  ref?: React.Ref<HTMLDivElement>;
}): React.JSX.Element {
  return (
    <ScrollAreaPrimitive.Scrollbar
      ref={ref}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "z-10 flex touch-none select-none opacity-0 transition-opacity duration-200 delay-300 data-hovering:opacity-100 data-hovering:delay-0 data-scrolling:opacity-100 data-scrolling:delay-0 group-focus-within/scroll-area:opacity-100 group-focus-within/scroll-area:delay-0 active:opacity-100 active:delay-0 motion-reduce:transition-none",
        orientation === "vertical" && "w-2.5 border-l border-l-transparent p-px",
        orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent p-px",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-muted-foreground/40 hover:bg-muted-foreground/60"
      />
      {children}
    </ScrollAreaPrimitive.Scrollbar>
  );
}
