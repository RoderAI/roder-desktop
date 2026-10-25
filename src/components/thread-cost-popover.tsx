import { Popover } from "@base-ui/react/popover";
import { useRef, useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { roderIpc } from "@/lib/roder-ipc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatEstimatedCost, openRouterPricing } from "@/lib/thread-cost";
import { estimateThreadTreeCost, loadThreadCostTree } from "@/lib/thread-cost-tree";
import { useRoderStore } from "@/stores/roder-store";

function TokenCategories({
  categories,
}: {
  categories: { label: string; tokens: number | null; cost: number | null }[];
}) {
  return (
    <dl className="mt-2 space-y-1 text-sm font-normal text-muted-foreground">
      {categories.map((category) => (
        <div key={category.label} className="flex items-center justify-between gap-3">
          <dt>{category.label}</dt>
          <dd className="text-right tabular-nums">
            {category.tokens === null ? "Unavailable" : `${category.tokens.toLocaleString()} tokens`}
            {category.cost !== null ? ` · ${formatEstimatedCost(category.cost)}` : ""}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const contributionColors = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
];

export function ThreadCostPopover({ threadId }: { threadId: string }): React.JSX.Element {
  const [tree, setTree] = useState<Awaited<ReturnType<typeof loadThreadCostTree>>>({ threads: [], incomplete: false });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const requestVersion = useRef(0);
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  const mounted = useRef(false);
  const trackedIds = useRef<Set<string> | null>(null);
  const [tab, setTab] = useState("thread");
  const estimate = estimateThreadTreeCost(tree);
  const partial = estimate.partial;
  const contributions =
    tab === "thread"
      ? estimate.threads.map((thread) => ({ id: thread.id, cost: thread.total }))
      : estimate.models.map((model) => ({ id: model.group, cost: model.cost }));
  const totalLabel =
    status === "loading" ? "…" : status === "error" ? "Unavailable" : formatEstimatedCost(estimate.total);

  async function refresh() {
    if (refreshing.current) {
      refreshAgain.current = true;
      return;
    }
    refreshing.current = true;
    const version = ++requestVersion.current;
    try {
      const result = await loadThreadCostTree(
        threadId,
        roderIpc,
        (id) => useRoderStore.getState().subagentTracesByThread[id] ?? [],
      );
      if (version === requestVersion.current) {
        trackedIds.current = new Set(result.threads.map((thread) => thread.id));
        setTree(result);
        setStatus("ready");
      }
    } catch {
      if (version === requestVersion.current) setStatus("error");
    }
    refreshing.current = false;
    if (refreshAgain.current && mounted.current) {
      refreshAgain.current = false;
      void refresh();
    }
  }

  useMountEffect(() => {
    mounted.current = true;
    trackedIds.current = new Set([threadId]);
    void refresh();
    const unsubscribe = window.roderDesktop.onNotification((notification) => {
      const params = notification.params as { threadId?: string } | undefined;
      if (
        notification.method === "turn/completed" ||
        notification.method === "turn/subagentTraceCompleted" ||
        notification.method === "team/member/completed"
      ) {
        if (!params?.threadId || trackedIds.current?.has(params.threadId) || notification.method !== "turn/completed")
          void refresh();
      }
    });
    return () => {
      mounted.current = false;
      requestVersion.current++;
      unsubscribe();
    };
  });

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) void refresh();
      }}
    >
      <Popover.Trigger
        className="no-drag rounded-md px-2 py-1 text-sm font-medium tabular-nums text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Estimated thread cost: ${totalLabel}${partial ? ", partial" : ""}`}
      >
        {status === "error" || (status === "ready" && estimate.total === null)
          ? "Cost unavailable"
          : `~${totalLabel}${partial ? "+" : ""}`}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={10} className="no-drag z-[110]">
          <Popover.Popup
            aria-label="Estimated thread cost"
            className="w-96 max-w-[calc(100vw-2rem)] rounded-xl bg-popover text-base font-medium text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none"
          >
            <div className="space-y-4 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="tabular-nums text-foreground">
                    {totalLabel}
                    {partial ? "+" : ""}
                  </p>
                  <p className="text-sm font-normal text-muted-foreground">Estimated API cost</p>
                </div>
                <div className="text-right text-sm font-normal text-muted-foreground">
                  <p>OpenRouter rates</p>
                  <p>{openRouterPricing.fetchedAt.slice(0, 10)}</p>
                </div>
              </div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-muted/40" aria-hidden="true">
                {contributions.map((model, index) =>
                  model.cost !== null && model.cost > 0 ? (
                    <span
                      key={model.id}
                      className={contributionColors[index % contributionColors.length]}
                      style={{ width: `${(model.cost! / estimate.total!) * 100}%` }}
                    />
                  ) : null,
                )}
              </div>
              <Tabs value={tab} onValueChange={setTab} className="min-w-0 flex-col">
                <TabsList className="h-8 w-full shrink-0 bg-muted/40">
                  <TabsTrigger value="thread" className="h-full">
                    By thread
                  </TabsTrigger>
                  <TabsTrigger value="models" className="h-full">
                    By model
                  </TabsTrigger>
                </TabsList>
                <TabsContent
                  value="thread"
                  className="min-h-0 w-full max-h-60 flex-none space-y-3 overflow-y-auto pt-2"
                >
                  {estimate.threads.map((thread, index) => (
                    <div key={thread.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                          <span
                            aria-hidden="true"
                            className={`mt-1 size-2 shrink-0 rounded-full ${contributionColors[index % contributionColors.length]}`}
                          />
                          <div className="min-w-0">
                            <p className="truncate" title={thread.title}>
                              {thread.title}
                            </p>
                            {thread.id !== threadId ? (
                              <p className="text-sm font-normal text-muted-foreground">Subagent</p>
                            ) : null}
                          </div>
                        </div>
                        <span className="shrink-0 tabular-nums">
                          {formatEstimatedCost(thread.total)}
                          {thread.partial && thread.total !== null ? "+" : ""}
                        </span>
                      </div>
                      <TokenCategories categories={thread.categories} />
                    </div>
                  ))}
                  {status === "loading" ? <p className="font-normal text-muted-foreground">Loading usage…</p> : null}
                </TabsContent>
                <TabsContent
                  value="models"
                  className="min-h-0 w-full max-h-60 flex-none space-y-3 overflow-y-auto pt-2"
                >
                  {estimate.models.length ? (
                    estimate.models.map((model, index) => (
                      <div key={model.group}>
                        <div className="flex items-start justify-between gap-3">
                          <span
                            aria-hidden="true"
                            className={`mt-1 size-2 shrink-0 rounded-full ${contributionColors[index % contributionColors.length]}`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate" title={model.group}>
                              {model.name}
                            </p>
                          </div>
                          <span className="shrink-0 tabular-nums">
                            {status === "error" ? "Unavailable" : formatEstimatedCost(model.cost)}
                            {model.partial && model.cost !== null ? "+" : ""}
                          </span>
                        </div>
                        <TokenCategories categories={model.categories} />
                      </div>
                    ))
                  ) : (
                    <p className="font-normal text-muted-foreground">
                      {status === "loading"
                        ? "Loading usage…"
                        : status === "error"
                          ? "Usage unavailable."
                          : "No recorded token usage yet."}
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            </div>
            {status === "error" || estimate.unpricedModels.length > 0 || partial ? (
              <div className="space-y-1 border-t border-border/70 px-4 py-3 text-sm font-normal text-muted-foreground">
                {status === "error" ? <p role="alert">Usage could not be loaded. Reopen to retry.</p> : null}
                {estimate.unpricedModels.length ? (
                  <p>Some models have no matching rate; their cost is excluded.</p>
                ) : null}
                {partial ? (
                  <p>Partial subtotal: some thread usage, prices or descendant records are unavailable.</p>
                ) : null}
              </div>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
