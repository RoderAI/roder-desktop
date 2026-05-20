import * as React from "react";
import { cn } from "@/lib/utils";

export type KbdProps = React.HTMLAttributes<HTMLElement>;

export function Kbd({ className, ...props }: KbdProps): React.JSX.Element {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-sidebar-active/20 px-1.5 font-mono text-base font-medium leading-none text-sidebar-muted",
        className,
      )}
      {...props}
    />
  );
}
