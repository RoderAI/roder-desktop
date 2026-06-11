import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({
  className,
  ref,
  ...props
}: TextareaProps & { ref?: React.Ref<HTMLTextAreaElement> }): React.JSX.Element {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-16 w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-[var(--font-ui)] text-[var(--font-size-ui)] leading-[1.45] text-foreground caret-primary outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
