import { Popover } from "@base-ui/react/popover";
import { RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { roderIpc } from "@/lib/roder-ipc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createThreadAccountingRefreshScheduler, shouldRefreshThreadAccounting } from "@/lib/thread-accounting-refresh";
import { formatEstimatedCost, openRouterPricing, type TokenCostCategory } from "@/lib/thread-cost";
import { estimateThreadTreeCost, loadThreadCostTree } from "@/lib/thread-cost-tree";
import { useRoderStore } from "@/stores/roder-store";

type AccountingEstimate = ReturnType<typeof estimateThreadTreeCost>;
type AccountingStatus = "loading" | "ready" | "error";

function TokenCategories({ categories }: { categories: TokenCostCategory[] }) {
  return (
    <dl className="mt-2 space-y-1 text-sm font-normal text-muted-foreground">
      {categories.map((category) => (
        <div key={category.label} className="flex items-start justify-between gap-3">
          <dt>{category.label}</dt>
          <dd className="text-right tabular-nums">
            <span>
              {category.tokens === null ? "Tokens unavailable" : `${category.tokens.toLocaleString()} tokens`}
              {" · "}
              {category.cost === null
                ? "Cost unavailable"
                : `${formatEstimatedCost(category.cost)}${category.partial ? " known subtotal" : ""}`}
            </span>
            {category.partial ? <span className="block">Partial estimate</span> : null}
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

export function ThreadAccountingSummary({
  threadId,
  estimate,
  status,
  tab,
  onTabChange,
  onRefresh,
  onScanMore,
  refreshing = false,
  scanLimited = false,
  scanAtMaximum = false,
}: {
  threadId: string;
  estimate: AccountingEstimate;
  status: AccountingStatus;
  tab: string;
  onTabChange: (tab: string) => void;
  onRefresh: () => void;
  onScanMore: () => void;
  refreshing?: boolean;
  scanLimited?: boolean;
  scanAtMaximum?: boolean;
}): React.JSX.Element {
  const ownThread = estimate.threads.find((thread) => thread.id === threadId);
  const subagents = estimate.threads.filter((thread) => thread.id !== threadId);
  const subagentTokens = subagents.reduce((sum, thread) => sum + thread.usage.totalTokens, 0);
  const subagentUsageAvailable = subagents.some((thread) => thread.usageAvailable);
  const traceOnly = estimate.threads.some((thread) => thread.source === "trace");
  const contributions =
    tab === "thread"
      ? estimate.threads.map((thread) => ({ id: thread.id, cost: thread.total }))
      : estimate.models.map((model) => ({ id: model.group, cost: model.cost }));
  const unavailable = status === "error";
  const totalLabel =
    status === "loading" ? "Loading..." : unavailable ? "Unavailable" : formatEstimatedCost(estimate.total);
  const sourceLabels = {
    analytics: "Model analytics",
    trace: "Trace only",
    unavailable: "No model attribution",
  };

  return (
    <>
      <div className="space-y-4 p-4">
        <div className="space-y-2">
          <p className="text-sm font-normal text-muted-foreground">Recorded tokens</p>
          <p className="font-semibold tabular-nums text-foreground">
            {status === "loading"
              ? "Loading..."
              : unavailable
                ? "Unavailable"
                : estimate.usageAvailable
                  ? estimate.usage.totalTokens.toLocaleString()
                  : "No recorded usage"}
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="font-normal text-muted-foreground">This thread</dt>
              <dd className="tabular-nums">
                {ownThread?.usageAvailable ? ownThread.usage.totalTokens.toLocaleString() : "Unavailable"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-normal text-muted-foreground">Subagents ({subagents.length})</dt>
              <dd className="tabular-nums">
                {subagentUsageAvailable
                  ? subagentTokens.toLocaleString()
                  : subagents.length
                    ? "Unavailable"
                    : "None recorded"}
              </dd>
            </div>
          </dl>
          {estimate.usageAvailable ? (
            <>
              <p className="text-sm font-normal tabular-nums text-muted-foreground">
                {estimate.usage.promptTokens.toLocaleString()} input ·{" "}
                {estimate.usage.completionTokens.toLocaleString()} output
              </p>
              <p className="text-sm font-normal tabular-nums text-muted-foreground">
                Cache read: {estimate.usage.cachedPromptTokens.toLocaleString()} · Cache write:{" "}
                {estimate.usage.cacheCreationPromptTokens.toLocaleString()}
              </p>
            </>
          ) : null}
        </div>
        <div className="flex items-start justify-between gap-4 border-t border-border/70 pt-3">
          <div>
            <p className="tabular-nums text-foreground">{totalLabel}</p>
            <p className="text-sm text-muted-foreground">
              {estimate.partial ? "Partial estimate" : "Estimated API cost"}
            </p>
          </div>
          <div className="text-right text-sm font-normal text-muted-foreground">
            <p>OpenRouter rates</p>
            <p>{openRouterPricing.fetchedAt.slice(0, 10)}</p>
          </div>
        </div>
        <p className="text-sm font-normal text-muted-foreground">
          Known priced contributions only. Not a provider invoice.
        </p>
        {estimate.unattributedTokens > 0 ? (
          <p className="rounded-lg bg-muted/30 p-3 text-sm font-normal">
            {estimate.unattributedTokens.toLocaleString()} recorded tokens are not attributed to a model and are
            excluded from the cost estimate.
          </p>
        ) : null}
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted/40" aria-hidden="true">
          {contributions.map((contribution, index) =>
            contribution.cost !== null && contribution.cost > 0 && estimate.total !== null && estimate.total > 0 ? (
              <span
                key={contribution.id}
                className={contributionColors[index % contributionColors.length]}
                style={{ width: `${(contribution.cost / estimate.total) * 100}%` }}
              />
            ) : null,
          )}
        </div>
        <Tabs value={tab} onValueChange={onTabChange} className="min-w-0 flex-col">
          <TabsList className="h-8 w-full shrink-0 bg-muted/40">
            <TabsTrigger value="thread" className="h-full">
              By thread
            </TabsTrigger>
            <TabsTrigger value="models" className="h-full">
              By model
            </TabsTrigger>
          </TabsList>
          <TabsContent value="thread" className="min-h-0 w-full space-y-3 pt-2">
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
                      <p className="text-sm font-normal text-muted-foreground">
                        {thread.id === threadId ? "Own usage" : `Subagent · Depth ${thread.depth ?? 1}`}
                        {" · "}
                        {sourceLabels[thread.source ?? "unavailable"]}
                      </p>
                      <p className="text-sm font-normal tabular-nums text-muted-foreground">
                        {thread.usageAvailable
                          ? `${thread.usage.totalTokens.toLocaleString()} recorded tokens`
                          : "No recorded token usage"}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular-nums">{formatEstimatedCost(thread.total)}</p>
                    {thread.partial ? (
                      <p className="text-sm font-normal text-muted-foreground">Partial estimate</p>
                    ) : null}
                  </div>
                </div>
                <TokenCategories categories={thread.categories} />
              </div>
            ))}
            {!estimate.threads.length ? (
              <p className="font-normal text-muted-foreground">
                {status === "loading"
                  ? "Loading usage..."
                  : unavailable
                    ? "Usage unavailable."
                    : "No recorded token usage yet."}
              </p>
            ) : null}
          </TabsContent>
          <TabsContent value="models" className="min-h-0 w-full space-y-3 pt-2">
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
                      <p className="text-sm font-normal tabular-nums text-muted-foreground">
                        {model.totalTokens.toLocaleString()} attributed tokens
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular-nums">{formatEstimatedCost(model.cost)}</p>
                      {model.partial ? (
                        <p className="text-sm font-normal text-muted-foreground">Partial estimate</p>
                      ) : null}
                    </div>
                  </div>
                  <TokenCategories categories={model.categories} />
                </div>
              ))
            ) : (
              <p className="font-normal text-muted-foreground">
                {status === "loading"
                  ? "Loading usage..."
                  : unavailable
                    ? "Usage unavailable."
                    : "No model-attributed usage yet."}
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
      <div className="space-y-3 border-t border-border/70 px-4 py-3 text-sm font-normal text-muted-foreground">
        {unavailable ? (
          <div className="flex items-center justify-between gap-3">
            <p role="alert">Usage could not be loaded.</p>
            <Button variant="outline" size="sm" className="rounded-md" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
          </div>
        ) : null}
        <div className="space-y-1">
          <p>Recorded totals update after turns finish, not live while a turn runs.</p>
          {traceOnly ? <p>Trace-only agent usage can be incomplete, especially in historical records.</p> : null}
          {estimate.partial ? <p>Some usage, prices, or descendant coverage could not be fully verified.</p> : null}
          {estimate.unpricedModels.length ? (
            <p>Some model or cache-write rates are unavailable. Only priced contributions are included.</p>
          ) : null}
          <p>Historical failures and archived agents may have incomplete usage.</p>
        </div>
        {estimate.warnings.length ? (
          <details>
            <summary className="cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Accounting notes ({estimate.warnings.length})
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {estimate.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {!unavailable ? (
            <Button variant="outline" size="sm" className="rounded-md" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw className="size-3.5" />
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
          ) : null}
          {scanLimited ? (
            <Button
              variant="outline"
              size="sm"
              className="rounded-md"
              onClick={onScanMore}
              disabled={refreshing || scanAtMaximum}
            >
              Scan more history
            </Button>
          ) : null}
        </div>
        <p className="tabular-nums">
          Scanned {estimate.scannedTurns.toLocaleString()} turns for task-agent history.
          {estimate.skippedTurns > 0 ? ` ${estimate.skippedTurns.toLocaleString()} turns not scanned.` : ""}
          {scanLimited && scanAtMaximum ? " Maximum scan budget reached." : ""}
        </p>
      </div>
    </>
  );
}

export function ThreadCostPopover({ threadId }: { threadId: string }): React.JSX.Element {
  const [tree, setTree] = useState<Awaited<ReturnType<typeof loadThreadCostTree>>>({ threads: [], incomplete: false });
  const [status, setStatus] = useState<AccountingStatus>("loading");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const requestVersion = useRef(0);
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  const mounted = useRef(false);
  const trackedIds = useRef<Set<string> | null>(null);
  const scanBudget = useRef({ maxTracePages: 256, maxThreads: 200 });
  const [tab, setTab] = useState("thread");
  const estimate = estimateThreadTreeCost(tree);
  const partial = estimate.partial;
  const scanLimited = estimate.skippedTurns > 0 || estimate.threads.length >= scanBudget.current.maxThreads;
  const scanAtMaximum = scanBudget.current.maxTracePages >= 8192 && scanBudget.current.maxThreads >= 2000;
  const totalLabel =
    status === "loading" ? "Loading..." : status === "error" ? "Unavailable" : formatEstimatedCost(estimate.total);

  async function refresh() {
    if (!mounted.current) return;
    if (refreshing.current) {
      refreshAgain.current = true;
      return;
    }
    refreshing.current = true;
    setIsRefreshing(true);
    const version = ++requestVersion.current;
    try {
      const result = await loadThreadCostTree(
        threadId,
        roderIpc,
        (id) => useRoderStore.getState().subagentTracesByThread[id] ?? [],
        scanBudget.current,
      );
      if (mounted.current && version === requestVersion.current) {
        trackedIds.current = new Set([threadId, ...result.threads.map((thread) => thread.id)]);
        setTree(result);
        setStatus("ready");
      }
    } catch {
      if (mounted.current && version === requestVersion.current) setStatus("error");
    }
    refreshing.current = false;
    if (mounted.current) setIsRefreshing(false);
    if (refreshAgain.current && mounted.current) {
      refreshAgain.current = false;
      void refresh();
    }
  }

  useMountEffect(() => {
    mounted.current = true;
    trackedIds.current = new Set([threadId]);
    void refresh();
    const scheduler = createThreadAccountingRefreshScheduler(() => void refresh());
    const unsubscribe = window.roderDesktop.onNotification((notification) => {
      if (trackedIds.current && shouldRefreshThreadAccounting(notification, trackedIds.current)) scheduler.schedule();
    });
    return () => {
      mounted.current = false;
      requestVersion.current++;
      scheduler.dispose();
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
        aria-label={`Recorded thread usage and estimated cost: ${totalLabel}${partial ? ", partial estimate" : ""}`}
      >
        {status === "error" || (status === "ready" && estimate.total === null)
          ? "Cost unavailable"
          : status === "loading"
            ? totalLabel
            : `~${totalLabel}${partial ? " · Partial estimate" : ""}`}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={10} className="no-drag z-[110]">
          <Popover.Popup
            aria-label="Thread usage and estimated cost"
            className="max-h-[min(42rem,calc(100dvh-2rem),var(--available-height))] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-xl bg-popover text-base font-medium text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none"
          >
            <ThreadAccountingSummary
              threadId={threadId}
              estimate={estimate}
              status={status}
              tab={tab}
              onTabChange={setTab}
              onRefresh={() => void refresh()}
              onScanMore={() => {
                scanBudget.current = {
                  maxTracePages: Math.min(scanBudget.current.maxTracePages * 4, 8192),
                  maxThreads: Math.min(scanBudget.current.maxThreads * 4, 2000),
                };
                void refresh();
              }}
              refreshing={isRefreshing}
              scanLimited={scanLimited}
              scanAtMaximum={scanAtMaximum}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
