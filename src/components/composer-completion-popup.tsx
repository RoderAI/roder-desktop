import { useCallback, type ReactNode } from "react";
import { completionOptionId } from "@/lib/composer-completions";
import { cn } from "@/lib/utils";

type ComposerCompletionPopupProps<T> = {
  visible: boolean;
  listboxId: string;
  ariaLabel: string;
  items: T[];
  highlightedIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (item: T) => void;
  renderItem: (params: ComposerCompletionRenderItemParams<T>) => ReactNode;
};

export type ComposerCompletionRenderItemParams<T> = {
  item: T;
  index: number;
  active: boolean;
};

export function ComposerCompletionPopup<T>({
  visible,
  listboxId,
  ariaLabel,
  items,
  highlightedIndex,
  onHighlight,
  onSelect,
  renderItem,
}: ComposerCompletionPopupProps<T>): React.JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <CompletionMenuShell className="absolute bottom-full left-0 right-0 z-50 mb-2">
      <CompletionMenuList id={listboxId} ariaLabel={ariaLabel}>
        {items.map((item, index) => {
          const active = index === highlightedIndex;
          return (
            <CompletionMenuOption
              key={completionOptionId(listboxId, index)}
              id={completionOptionId(listboxId, index)}
              index={index}
              active={active}
              onHighlight={onHighlight}
              onClick={() => onSelect(item)}
            >
              {renderItem({ item, index, active })}
            </CompletionMenuOption>
          );
        })}
      </CompletionMenuList>
    </CompletionMenuShell>
  );
}

export function CompletionMenuShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "composer-skill-menu overflow-hidden rounded-3xl bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CompletionMenuList({
  id,
  ariaLabel,
  children,
  className,
}: {
  id: string;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      id={id}
      role="listbox"
      aria-label={ariaLabel}
      className={cn("no-scrollbar max-h-72 scroll-py-1.5 overflow-y-auto overscroll-contain p-1.5", className)}
    >
      {children}
    </div>
  );
}

export function CompletionMenuOption({
  id,
  index,
  active,
  children,
  className,
  onClick,
  onHighlight,
}: {
  id: string;
  index: number;
  active: boolean;
  children: ReactNode;
  className?: string;
  onClick: () => void;
  onHighlight: (index: number) => void;
}): React.JSX.Element {
  // Ref identity controls whether React re-runs scrollIntoView for an unchanged active option.
  const scrollActiveOptionIntoView = useCallback((node: HTMLButtonElement | null): void => {
    node?.scrollIntoView({ block: "nearest" });
  }, []);

  return (
    <button
      ref={active ? scrollActiveOptionIntoView : undefined}
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={-1}
      data-completion-index={index}
      data-completion-active={active ? "true" : undefined}
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-2xl px-2.5 py-1.5 text-left outline-hidden select-none data-[completion-active=true]:bg-foreground/5 data-[completion-active=true]:text-foreground",
        className,
      )}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onMouseEnter={() => onHighlight(index)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function CompletionMenuCount({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="border-t border-border/70 px-4 py-1.5 text-sm text-muted-foreground">{children}</div>;
}

export { completionOptionId as composerCompletionOptionId };
