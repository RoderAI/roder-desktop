import * as React from "react";
import { Separator as BaseSeparator } from "@base-ui/react/separator";
import { cn } from "@/lib/utils";

export function Separator({
  className,
  orientation = "horizontal",
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSeparator> & {
  ref?: React.Ref<React.ElementRef<typeof BaseSeparator>>;
}): React.JSX.Element {
  return (
    <BaseSeparator
      ref={ref}
      orientation={orientation}
      className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
      {...props}
    />
  );
}
