import { Laptop, Loader2 } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Composer } from "@/components/composer";
import { TopBar } from "@/components/top-bar";
import { Transcript } from "@/components/transcript";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGodeAgent } from "@/hooks/use-gode-agent";

export function App(): React.JSX.Element {
  const agent = useGodeAgent();
  const activeThread = agent.threads.find((thread) => thread.id === agent.activeThreadId);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-screen w-screen overflow-hidden bg-background">
        <AppSidebar
          threads={agent.threads}
          activeThreadId={agent.activeThreadId}
          onSelectThread={agent.selectThread}
          onNewThread={() => void agent.newThread()}
        />
        <section className="flex min-w-0 flex-1 flex-col">
          <TopBar thread={activeThread} status={agent.status} onRestart={() => void agent.restart()} />
          <Transcript messages={agent.messages} />
          {agent.error && (
            <div className="mx-auto mb-3 w-full max-w-[980px] px-8 text-sm text-destructive">{agent.error}</div>
          )}
          <Composer
            busy={agent.busy}
            models={agent.models}
            selectedModel={agent.selectedModel}
            onSelectedModelChange={agent.setSelectedModel}
            onSend={agent.sendPrompt}
          />
          <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border px-8 text-xs text-muted-foreground">
            <Laptop className="size-4" />
            <span>Local</span>
            <span>{activeThread?.cwd?.split("/").filter(Boolean).pop() ?? "workspace"}</span>
            <span className="ml-auto flex items-center gap-2">
              {agent.busy && <Loader2 className="size-3 animate-spin" />}
              <Badge variant="muted" className="text-[11px]">
                {agent.status.state === "ready" ? "gode app-server" : agent.status.state}
              </Badge>
            </span>
          </footer>
        </section>
      </div>
    </TooltipProvider>
  );
}
