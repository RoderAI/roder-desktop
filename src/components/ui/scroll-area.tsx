import * as React from "react";
import { cn } from "@/lib/utils";

type ScrollAreaProps = React.HTMLAttributes<HTMLDivElement> & {
  viewportClassName?: string;
  viewportProps?: React.HTMLAttributes<HTMLDivElement>;
  viewportRef?: React.Ref<HTMLDivElement>;
  onViewportScroll?: React.UIEventHandler<HTMLDivElement>;
};

export function ScrollArea({
  className,
  children,
  ref,
  viewportClassName,
  viewportProps,
  viewportRef,
  onViewportScroll,
  ...props
}: ScrollAreaProps & { ref?: React.Ref<HTMLDivElement> }): React.JSX.Element {
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
}

export function ScrollBar({
  className,
  orientation = "vertical",
  children,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  orientation?: "vertical" | "horizontal";
  ref?: React.Ref<HTMLDivElement>;
}): React.JSX.Element {
  return (
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
  );
}
