import { useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { transcriptNavigationKeyIndex, type TranscriptNavigationItem } from "@/lib/transcript-navigation";
import { cn } from "@/lib/utils";

type TranscriptNavigationProps = {
  items: TranscriptNavigationItem[];
  activeId: string | null;
  bottomInsetPx: number;
  onSelect: (id: string) => void;
};

export function TranscriptNavigation({
  items,
  activeId,
  bottomInsetPx,
  onSelect,
}: TranscriptNavigationProps): React.JSX.Element | null {
  const navigationRef = useRef<HTMLElement | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const tabStopId = items.some((item) => item.id === focusedId) ? focusedId : (activeId ?? items[0]?.id);
  if (!items.length) return null;

  return (
    <nav
      ref={navigationRef}
      aria-label="Conversation message navigation"
      className="absolute left-0 top-4 z-20 flex w-5 flex-col justify-center"
      style={{ bottom: Math.max(16, bottomInsetPx) }}
    >
      <TooltipProvider delay={120}>
        <div className="max-h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((item, index) => {
            const active = item.id === activeId;
            const role = item.role === "user" ? "You" : item.role === "assistant" ? "Assistant" : "System";
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger
                  type="button"
                  data-transcript-nav={item.id}
                  tabIndex={tabStopId === item.id ? 0 : -1}
                  aria-label={`Jump to message ${index + 1}, ${role}: ${item.preview}`}
                  aria-current={active ? "location" : undefined}
                  className="group/nav-tick flex h-2 w-5 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onFocus={() => setFocusedId(item.id)}
                  onClick={() => onSelect(item.id)}
                  onKeyDown={(event) => {
                    const nextIndex = transcriptNavigationKeyIndex(event.key, index, items.length);
                    if (nextIndex === null) return;
                    event.preventDefault();
                    navigationRef.current
                      ?.querySelectorAll<HTMLButtonElement>("button[data-transcript-nav]")
                      [nextIndex]?.focus();
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none h-0.5 rounded-full transition-[width,background-color] duration-150 motion-reduce:transition-none",
                      active
                        ? "w-3.5 bg-foreground/80"
                        : "w-2 bg-muted-foreground/30 group-hover/nav-tick:w-3.5 group-hover/nav-tick:bg-muted-foreground/70 group-focus-visible/nav-tick:w-3.5",
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={8}
                  className="max-w-80 rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-border/70"
                >
                  <p className="text-sm font-medium text-muted-foreground">
                    {role} · Message {index + 1}
                  </p>
                  <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-base font-normal">
                    {item.preview}
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </nav>
  );
}
