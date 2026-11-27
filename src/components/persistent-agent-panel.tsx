import { useState } from "react";
import { PersistentAgentEditor } from "@/components/persistent-agents-page";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { persistentAgentsIpc } from "@/lib/persistent-agents-ipc";
import { roderIpc } from "@/lib/roder-ipc";
import type { PersistentAgentDetail } from "@/types/persistent-agents";

export function PersistentAgentPanel({ agentId }: { agentId: string }) {
  const [initial, setInitial] = useState<PersistentAgentDetail | null>(null);
  const [status, setStatus] = useState<PersistentAgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [observedAt, setObservedAt] = useState(() => Date.now());

  useMountEffect(() => {
    let mounted = true;
    let revision = 0;
    async function refresh() {
      const request = ++revision;
      try {
        const agent = await persistentAgentsIpc.read(agentId);
        if (!mounted || request !== revision) return;
        setInitial((previous) => previous ?? agent);
        setStatus(agent);
        setObservedAt(Date.now());
        setError(null);
      } catch (cause) {
        if (mounted && request === revision) setError(String(cause));
      }
    }
    void refresh();
    const unsubscribe = roderIpc.onNotification((notification) => {
      if (notification.method === "desktop/persistent-agents/changed") void refresh();
    });
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
      unsubscribe();
    };
  });

  async function perform<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      setStatus(await persistentAgentsIpc.read(agentId));
      setObservedAt(Date.now());
      return result;
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-auto bg-background p-4 text-base font-medium">
      <div className="space-y-4">
        <header className="space-y-1">
          <h1 className="font-semibold">Agent settings</h1>
          <p className="text-sm font-normal text-muted-foreground">
            Memory, schedules, and run controls. Proactive work requires Roder Desktop to stay open.
          </p>
        </header>
        {error ? (
          <div role="alert" className="space-y-2 rounded-lg border border-destructive p-3 text-destructive">
            <p>{error}</p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const agent = await persistentAgentsIpc.read(agentId);
                  setInitial((previous) => previous ?? agent);
                })
              }
            >
              Retry
            </Button>
          </div>
        ) : null}
        {initial && status ? (
          <PersistentAgentEditor
            initial={initial}
            status={status}
            busy={busy}
            observedAt={observedAt}
            perform={perform}
            showThreadLink={false}
          />
        ) : !error ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading agent settings...
          </p>
        ) : null}
      </div>
    </div>
  );
}
