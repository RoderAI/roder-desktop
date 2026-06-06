import { X } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FileTabsOverflowState, OpenFileTab } from "@/components/file-panel/types";
import { filePanelFileIcon, filePanelFileIconSpriteSheet, type FilePanelFileIcon } from "@/lib/file-panel";

const emptyFileTabsOverflowState: FileTabsOverflowState = {
  canScrollLeft: false,
  canScrollRight: false,
};

export function OpenFileTabs({
  tabs,
  activeKey,
  onSelect,
  onClose,
}: {
  tabs: OpenFileTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
}): React.JSX.Element {
  const [overflowState, setOverflowState] = useState<FileTabsOverflowState>(emptyFileTabsOverflowState);
  const tabsListNodeRef = useRef<HTMLElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const updateOverflowState = useCallback((node: HTMLElement) => {
    const scrollLeft = Math.max(0, node.scrollLeft);
    const maxScrollLeft = Math.max(0, node.scrollWidth - node.clientWidth);
    const nextState = {
      canScrollLeft: scrollLeft > 1,
      canScrollRight: maxScrollLeft - scrollLeft > 1,
    };
    setOverflowState((currentState) =>
      currentState.canScrollLeft === nextState.canScrollLeft && currentState.canScrollRight === nextState.canScrollRight
        ? currentState
        : nextState,
    );
  }, []);
  const tabsListRef = useCallback(
    (node: HTMLElement | null) => {
      if (tabsListNodeRef.current === node) {
        return;
      }
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      tabsListNodeRef.current = node;
      if (!node) {
        return;
      }
      updateOverflowState(node);
      if (typeof ResizeObserver === "undefined") {
        return;
      }
      const resizeObserver = new ResizeObserver(() => updateOverflowState(node));
      resizeObserver.observe(node);
      resizeObserverRef.current = resizeObserver;
    },
    [updateOverflowState],
  );
  useLayoutEffect(() => {
    const node = tabsListNodeRef.current;
    if (node) {
      updateOverflowState(node);
    }
  }, [activeKey, tabs.length, updateOverflowState]);
  const updateTabsScrollState = useCallback(
    (event: React.UIEvent<HTMLElement>) => updateOverflowState(event.currentTarget),
    [updateOverflowState],
  );

  if (tabs.length === 0) {
    return <div className="min-w-0 flex-1" />;
  }

  return (
    <div className="relative flex min-w-0 flex-1 items-center overflow-hidden">
      <span aria-hidden dangerouslySetInnerHTML={{ __html: filePanelFileIconSpriteSheet }} />
      <Tabs value={activeKey ?? undefined} onValueChange={onSelect} className="min-w-0 flex-1 overflow-hidden">
        <TabsList
          ref={tabsListRef}
          variant="chrome"
          className="file-tabs-scroll w-full max-w-full flex-nowrap justify-start overflow-x-auto overflow-y-hidden pr-8 scroll-pr-8"
          aria-label="Open files"
          onScroll={updateTabsScrollState}
        >
          {tabs.map((tab) => (
            <div
              key={tab.key}
              ref={tab.key === activeKey ? scrollFileTabIntoView : undefined}
              className="group/tab relative flex h-7 min-w-20 max-w-36 shrink-0 items-center overflow-hidden rounded-full text-muted-foreground transition-colors"
              title={tab.state.label}
            >
              <TabsTrigger
                value={tab.key}
                aria-label={tab.title}
                className="min-w-0 flex-1 justify-start overflow-hidden pl-2 pr-2"
              >
                <span className="relative flex size-4 shrink-0 items-center justify-center">
                  <span className="flex shrink-0 transition-opacity group-hover/tab:opacity-0 group-focus-within/tab:opacity-0 [&_svg]:size-3.5">
                    <FileTabIcon path={tab.state.selection.relativePath} />
                  </span>
                </span>
                <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">{tab.title}</span>
              </TabsTrigger>
              <button
                type="button"
                className="pointer-events-none absolute left-1 top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-full bg-muted-foreground/70 text-background opacity-0 outline-none transition-colors hover:bg-muted-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-100"
                aria-label={`Close ${tab.title}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onClose(tab.key);
                }}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </TabsList>
      </Tabs>
      {overflowState.canScrollLeft && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent"
        />
      )}
      {overflowState.canScrollRight && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-r from-transparent to-background"
        />
      )}
    </div>
  );
}

function scrollFileTabIntoView(node: HTMLDivElement | null): void {
  node?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function FileTabIcon({ path }: { path: string }): React.JSX.Element {
  const icon = filePanelFileIcon(path);
  return <ResolvedFileIcon icon={icon} className="file-panel-tab-icon shrink-0" />;
}

function ResolvedFileIcon({ icon, className }: { icon: FilePanelFileIcon; className?: string }): React.JSX.Element {
  const iconName = icon.name.replace(/^#/, "");
  return (
    <svg
      data-icon-name={icon.remappedFrom ?? icon.name}
      data-icon-token={icon.token}
      aria-hidden
      className={className}
      viewBox={icon.viewBox ?? `0 0 ${icon.width ?? 16} ${icon.height ?? 16}`}
      width={icon.width ?? 16}
      height={icon.height ?? 16}
    >
      <use href={`#${iconName}`} />
    </svg>
  );
}
