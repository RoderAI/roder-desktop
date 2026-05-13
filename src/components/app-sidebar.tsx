import { Boxes, ChevronLeft, ChevronRight, MoreHorizontal, Search, Send, Settings2, SidebarIcon, SlidersHorizontal } from "lucide-react";
import type { GodeThread } from "@/types/gode";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type AppSidebarProps = {
  threads: GodeThread[];
  activeThreadId: string;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
};

const pinnedLabels = [
  "Org management and use...",
  "Vex self-hosting and depl...",
  "jj backend performance a...",
  "End to end authentication...",
  "Build and deploy with loc...",
];

const homeLabels = ["Subagent creation for Ve...", "Self-learning sub-agent f..."];

export function AppSidebar({ threads, activeThreadId, onSelectThread, onNewThread }: AppSidebarProps): React.JSX.Element {
  const visibleThreads = threads.slice(0, 14);

  return (
    <aside className="drag-region flex h-screen w-[274px] shrink-0 flex-col border-r border-border bg-[#e8e8e8] text-[#575757]">
      <div className="flex h-[64px] items-center gap-4 px-5 pl-[104px]">
        <SidebarIcon className="size-4 opacity-70" />
        <Search className="size-5 opacity-70" />
        <div className="ml-auto flex items-center gap-3 opacity-60">
          <ChevronLeft className="size-5" />
          <ChevronRight className="size-5" />
        </div>
      </div>

      <div className="no-drag flex flex-col gap-1 px-3">
        <Button variant="ghost" className="h-10 justify-start gap-3 px-3 text-[15px] text-[#565656]" onClick={onNewThread}>
          <Send className="size-5" />
          New Agent
          <span className="ml-auto text-xs text-[#9a9a9a]">⌘N</span>
        </Button>
        <Button variant="ghost" className="h-10 justify-start gap-3 px-3 text-[15px] text-[#565656]">
          <Boxes className="size-5" />
          Marketplace
        </Button>
      </div>

      <ScrollArea className="no-drag mt-6 min-h-0 flex-1 px-2">
        <SidebarSection title="Pinned" items={pinnedLabels} />
        <SidebarSection
          title="codex-issues"
          items={["Repository contents over..."]}
          className="mt-8"
        />
        <div className="mt-8">
          <div className="px-3 text-[14px] text-[#7c7c7c]">vex</div>
          <div className="mt-3 flex flex-col gap-1">
            {visibleThreads.map((thread) => (
              <button
                key={thread.id}
                className={cn(
                  "flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] text-[#5b5b5b] outline-none hover:bg-[#dddddd]",
                  thread.id === activeThreadId && "bg-[#d8d8d8] text-[#242424]",
                )}
                onClick={() => onSelectThread(thread.id)}
              >
                <span className="size-1.5 shrink-0 rounded-full bg-[#b9b9b9]" />
                <span className="truncate">{thread.name ?? (thread.preview || "Untitled agent")}</span>
              </button>
            ))}
            <SidebarMore />
          </div>
        </div>
        <SidebarSection title="Home" items={homeLabels} className="mt-8 pb-10" />
      </ScrollArea>

      <div className="no-drag flex h-[72px] items-center gap-3 px-4">
        <div className="grid size-9 place-items-center rounded-full bg-[#d9d9d9] text-xs text-[#6b6b6b]">PZ</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-[#3f3f3f]">P Z</div>
          <div className="truncate text-sm text-[#787878]">Cosine</div>
        </div>
        <SlidersHorizontal className="size-4 opacity-70" />
        <Settings2 className="size-4 opacity-70" />
      </div>
    </aside>
  );
}

function SidebarSection({ title, items, className }: { title: string; items: string[]; className?: string }): React.JSX.Element {
  return (
    <section className={className}>
      <div className="px-3 text-[14px] text-[#7c7c7c]">{title}</div>
      <div className="mt-3 flex flex-col gap-1">
        {items.map((item) => (
          <button key={item} className="flex h-9 items-center gap-3 rounded-lg px-3 text-left text-[15px] text-[#5b5b5b] hover:bg-[#dddddd]">
            <span className="size-1.5 shrink-0 rounded-full bg-[#b9b9b9]" />
            <span className="truncate">{item}</span>
          </button>
        ))}
        {title !== "Home" && <SidebarMore />}
      </div>
    </section>
  );
}

function SidebarMore(): React.JSX.Element {
  return (
    <button className="flex h-9 items-center gap-3 rounded-lg px-3 text-left text-[15px] text-[#828282] hover:bg-[#dddddd]">
      <MoreHorizontal className="size-4" />
      More
    </button>
  );
}
