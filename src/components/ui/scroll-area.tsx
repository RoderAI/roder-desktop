import * as React from "react";
import { cn } from "@/lib/utils";

type ScrollAreaProps = React.HTMLAttributes<HTMLDivElement> & {
  viewportClassName?: string;
  viewportProps?: React.HTMLAttributes<HTMLDivElement>;
  viewportRef?: React.Ref<HTMLDivElement>;
  onViewportScroll?: React.UIEventHandler<HTMLDivElement>;
};

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, children, viewportClassName, viewportProps, viewportRef, onViewportScroll, ...props }, ref) => {
    const { className: viewportPropsClassName, ...restViewportProps } = viewportProps ?? {};
    return (
      <div ref={ref} className={cn("relative overflow-hidden", className)} {...props}>
        <div
          ref={viewportRef}
          className={cn("size-full overflow-auto rounded-[inherit]", viewportClassName, viewportPropsClassName)}
          {...restViewportProps}
          onScroll={onViewportScroll}
        >
          {children}
        </div>
      </div>
    );
  },
);

ScrollArea.displayName = "ScrollArea";

export const ScrollBar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { orientation?: "vertical" | "horizontal" }
>(({ className, orientation = "vertical", children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "pointer-events-none absolute flex touch-none select-none transition-colors",
      orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent p-px",
      orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent p-px",
      className,
    )}
    {...props}
  >
    {children}
  </div>
));

ScrollBar.displayName = "ScrollBar";
