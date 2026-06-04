import { cn } from "@/lib/utils";

export const chromeIconButtonClassName =
  "no-drag size-8 rounded-full text-muted-foreground/85 hover:bg-accent/60 hover:text-foreground active:scale-95 [&_svg]:size-5";

export function chromeIconButtonClassNameForState(active?: boolean, className?: string): string {
  return cn(chromeIconButtonClassName, active && "bg-accent/60 text-foreground hover:bg-accent/60", className);
}
