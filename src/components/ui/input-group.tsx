import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function InputGroup({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element {
  return (
    <div
      data-slot="input-group"
      className={cn(
        "group/input-group flex min-h-8 w-full items-center rounded-lg border border-input bg-background text-foreground shadow-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupInput({ className, ...props }: React.ComponentProps<"input">): React.JSX.Element {
  return (
    <input
      data-slot="input-group-input"
      className={cn(
        "min-w-0 flex-1 bg-transparent px-3 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & {
  align?: "inline-start" | "inline-end";
}): React.JSX.Element {
  return (
    <div
      data-slot="input-group-addon"
      data-align={align}
      className={cn("flex items-center gap-1 px-1", align === "inline-end" && "ml-auto", className)}
      {...props}
    />
  );
}

function InputGroupButton({
  className,
  variant = "ghost",
  size = "icon-xs",
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <Button
      data-slot="input-group-button"
      variant={variant}
      size={size}
      className={cn("shrink-0 rounded-md text-muted-foreground", className)}
      {...props}
    />
  );
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput };
