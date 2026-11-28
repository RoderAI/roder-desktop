import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { Button } from "@/components/ui/button";
import { RoderAgentCreateDialog } from "@/components/roder-agent-create-dialog";
import { RoderAgentAvatar } from "@/components/roder-agent-avatar";
import { RoderAgentFiles } from "@/components/roder-agent-files";
import { RoderAgentImageSetup } from "@/components/roder-agent-image-setup";
import { roderAgentsIpc } from "@/lib/roder-agents-ipc";
import { roderAgentCharacterPresentation } from "@/lib/roder-agent-character";
import { roderIpc } from "@/lib/roder-ipc";
import { cn } from "@/lib/utils";
import type { RoderAgent, RoderAgentDetail } from "@/types/roder-agents";
import type { RoderModel, Workspace } from "@/types/roder";

const fieldClass =
  "w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function RoderAgentsPage({
  create = false,
  onCreateHandled,
}: { create?: boolean; onCreateHandled?: () => void } = {}) {
  const [roderAgents, setRoderAgents] = useState<RoderAgent[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<RoderAgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [models, setModels] = useState<RoderModel[]>([]);
  const [observedAt, setObservedAt] = useState(() => Date.now());

  async function refresh() {
    const result = await roderAgentsIpc.list();
    setRoderAgents(result.roders);
    setObservedAt(Date.now());
  }
  useMountEffect(() => {
    let mounted = true;
    void Promise.all([roderAgentsIpc.list(), window.roderDesktop.request("workspace/list", {})])
      .then(([result, spaces]) => {
        if (!mounted) return;
        setRoderAgents(result.roders);
        setObservedAt(Date.now());
        setWorkspaces((spaces as { workspaces: Workspace[] }).workspaces);
      })
      .catch((cause) => {
        if (mounted) setError(String(cause));
      });
    void window.roderDesktop
      .request("model/list", {})
      .then((result) => {
        if (mounted) setModels((result as { models: RoderModel[] }).models);
      })
      .catch((cause) => {
        if (mounted) setError(`Could not load engine models: ${String(cause)}`);
      });
    const timer = setInterval(() => {
      if (mounted) void refresh().catch((cause) => setError(String(cause)));
    }, 15000);
    const unsubscribe = roderIpc.onNotification((notification) => {
      if (mounted && notification.method === "desktop/roders/changed")
        void refresh().catch((cause) => setError(String(cause)));
    });
    return () => {
      mounted = false;
      clearInterval(timer);
      unsubscribe();
    };
  });
  async function perform<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    let result: T | undefined;
    try {
      result = await action();
      await refresh();
    } catch (cause) {
      setError(String(cause));
    }
    setBusy(false);
    return result;
  }
  return (
    <div className="h-full overflow-auto bg-background p-4 text-base font-medium">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="space-y-2">
          <h1 className="font-semibold">Roders</h1>
          <p className="text-muted-foreground font-normal">
            Project agents with memory and delegated work. Proactive runs require this app to stay open.
          </p>
        </header>
        {error && !creating && !create ? (
          <div role="alert" className="rounded-lg border border-destructive p-3 text-destructive">
            {error}
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="space-y-3">
            <h2 className="font-semibold">Your Roders</h2>
            {roderAgents.length === 0 ? (
              <p className="text-muted-foreground font-normal">Create a Roder for a project you want to keep moving.</p>
            ) : (
              <ul className="space-y-1">
                {roderAgents.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex h-11 w-full items-center gap-2.5 rounded-xl px-2 text-left hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
                        selected?.id === c.id && "bg-accent/60",
                      )}
                      onClick={async () => {
                        const roderAgent = await perform(() => roderAgentsIpc.read(c.id));
                        if (roderAgent) setSelected(roderAgent);
                      }}
                    >
                      <RoderAgentAvatar id={c.id} sprite={c.sprite} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{c.name}</span>
                        <span className="block truncate text-sm font-normal text-muted-foreground">{c.mission}</span>
                      </span>
                      <span className="shrink-0 text-sm text-muted-foreground">
                        {c.active ? "Running" : c.enabled ? "Enabled" : "Paused"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <RoderAgentCreateDialog
              open={creating || create}
              onOpenChange={(open) => {
                setCreating(open);
                if (open) setError(null);
                if (!open) onCreateHandled?.();
              }}
              workspaces={workspaces}
              models={models}
              error={error}
              onCreate={async (params) => {
                const roderAgent = await perform(() => roderAgentsIpc.create(params));
                if (!roderAgent) return false;
                setSelected(roderAgent);
                return true;
              }}
            />
          </section>
          <section className="lg:col-span-2">
            {selected ? (
              <RoderAgentEditor
                key={selected.id}
                initial={selected}
                status={roderAgents.find((c) => c.id === selected.id) ?? selected}
                busy={busy}
                observedAt={observedAt}
                perform={perform}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-border p-4 text-muted-foreground font-normal">
                Select a Roder to edit its files and opt in to proactive work.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export function RoderAgentEditor({
  initial,
  status,
  busy,
  observedAt,
  perform,
  showThreadLink = true,
}: {
  initial: RoderAgentDetail;
  status: RoderAgent;
  busy: boolean;
  observedAt: number;
  perform: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  showThreadLink?: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{status.name}</h2>
        {showThreadLink ? (
          <Link
            to="/threads/$threadId"
            params={{ threadId: status.threadId }}
            search={true}
            className="rounded-md px-3 py-2 underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open Roder thread
          </Link>
        ) : null}
      </header>
      <p className="text-sm text-muted-foreground">
        Local device · {status.model ? `${status.model} · ${status.modelProvider}` : "Engine default model"}
        {status.reasoning ? ` · ${status.reasoning} reasoning` : ""}
      </p>
      <RoderAgentCharacter status={status} busy={busy} perform={perform} />
      <div className="rounded-xl border border-border p-3 space-y-3">
        <p className="text-sm text-muted-foreground">
          Permissions: Bypass (all tool approvals). Always applied to Roder turns.
        </p>
        <p>
          {status.enabled ? "Proactive work is enabled" : "Proactive work is paused"}
          {status.active ? " · Run active" : ""}
        </p>
        <p className="text-sm text-muted-foreground">
          {status.runs.filter((at) => at > observedAt - 86400000).length}/{status.maxRunsPerDay} daily runs
        </p>
        <p className="text-sm text-muted-foreground font-normal">
          Enabling allows model and tool use in this project within the limits below. Pausing requests interruption of
          the current run. Run once is an explicit manual action and uses the same budget.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await roderAgentsIpc.update({ id: status.id, enabled: !status.enabled });
              })
            }
          >
            {status.enabled ? "Pause and interrupt" : "Enable proactive work"}
          </Button>
          <Button
            disabled={busy || !!status.active}
            variant="outline"
            onClick={() =>
              void perform(async () => {
                await roderAgentsIpc.run(status.id);
              })
            }
          >
            Run once
          </Button>
          <Button
            disabled={busy || !!status.active}
            variant="outline"
            onClick={async () => {
              const result = await perform(() => roderAgentsIpc.compact(status.id));
              if (result)
                setMessage(
                  result.compacted
                    ? "Engine compacted the working context. Thread history is retained."
                    : (result.reason ?? "No compaction needed."),
                );
            }}
          >
            Compact context
          </Button>
          <Button
            disabled={busy || !!status.active}
            variant="outline"
            onClick={async () => {
              const moved = await perform(() => roderAgentsIpc.freshConversation(status.id));
              if (moved)
                setMessage(
                  "Started a fresh conversation. Files, issues and budgets are unchanged; the previous thread is listed below.",
                );
            }}
          >
            Fresh conversation
          </Button>
        </div>
        {status.lastError ? (
          <p role="status" className="text-sm text-destructive">
            {status.lastError}
          </p>
        ) : null}
        {message ? (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        ) : null}
      </div>
      {status.previousThreadIds.length ? (
        <section aria-label="Previous conversations" className="space-y-2">
          <h3 className="font-semibold">Previous conversations</h3>
          <p className="text-sm text-muted-foreground font-normal">
            Threads this Roder talked in before a fresh conversation. They stay readable; its tools work only in the
            current thread.
          </p>
          <ul className="space-y-1">
            {status.previousThreadIds.map((threadId, index) => (
              <li key={threadId}>
                <Link
                  to="/threads/$threadId"
                  params={{ threadId }}
                  search={true}
                  className="rounded-md px-3 py-2 underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Conversation {index + 1}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <RoderAgentFiles key={status.id} roderId={status.id} initialFiles={initial.files} />
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const saved = await perform(() =>
            roderAgentsIpc.update({
              id: status.id,
              name: String(data.get("name")),
              intervalMinutes: Number(data.get("interval")),
              maxRunsPerDay: Number(data.get("runs")),
              maxRunMinutes: Number(data.get("minutes")),
              eventMethods: String(data.get("events"))
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            }),
          );
          if (saved) setMessage("Controls saved.");
        }}
      >
        <label className="block space-y-1">
          <span>Name</span>
          <input name="name" defaultValue={initial.name} required maxLength={120} className={fieldClass} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1">
            <span>Check-in minutes (0 = off)</span>
            <input
              name="interval"
              type="number"
              min={0}
              max={525600}
              defaultValue={initial.intervalMinutes}
              required
              className={fieldClass}
            />
          </label>
          <label className="space-y-1">
            <span>Runs per 24 hours</span>
            <input
              name="runs"
              type="number"
              min={1}
              max={100}
              defaultValue={initial.maxRunsPerDay}
              required
              className={fieldClass}
            />
          </label>
          <label className="space-y-1">
            <span>Minutes per run</span>
            <input
              name="minutes"
              type="number"
              min={1}
              max={60}
              defaultValue={initial.maxRunMinutes}
              required
              className={fieldClass}
            />
          </label>
        </div>
        <label className="block space-y-1">
          <span>Wake on events (comma-separated methods)</span>
          <input
            name="events"
            defaultValue={initial.eventMethods.join(", ")}
            placeholder="turn/completed"
            className={fieldClass}
          />
          <span className="text-sm text-muted-foreground font-normal">
            Other threads only. Events coalesce and never bypass the daily budget.
          </span>
        </label>
        <Button type="submit" disabled={busy}>
          Save controls
        </Button>
      </form>
      <section className="space-y-3">
        <h3 className="font-semibold">Scheduled wakes</h3>
        {status.wakes.length ? (
          <ul className="space-y-2">
            {status.wakes.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5">
                <span>
                  {w.reason}
                  <span className="block text-sm text-muted-foreground">{new Date(w.at).toLocaleString()}</span>
                </span>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await roderAgentsIpc.cancelWake(status.id, w.id);
                    })
                  }
                >
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No pending wakes.</p>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void perform(async () => {
              await roderAgentsIpc.schedule(
                status.id,
                new Date(String(data.get("at"))).getTime(),
                String(data.get("reason")),
              );
            });
          }}
        >
          <label className="space-y-1">
            <span>Wake time</span>
            <input name="at" type="datetime-local" required className={fieldClass} />
          </label>
          <label className="flex-1 space-y-1">
            <span>Reason</span>
            <input name="reason" required maxLength={2000} className={fieldClass} />
          </label>
          <Button type="submit" disabled={busy}>
            Schedule
          </Button>
        </form>
      </section>
    </div>
  );
}

function RoderAgentCharacter({
  status,
  busy,
  perform,
}: {
  status: RoderAgent;
  busy: boolean;
  perform: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}): React.JSX.Element {
  const [setupOpen, setSetupOpen] = useState(false);
  const [configuredVersion, setConfiguredVersion] = useState<number | null>(null);
  const sprite = status.sprite;
  const keyConfigured = configuredVersion !== null && configuredVersion === sprite?.updatedAt;
  const generating = sprite?.status === "generating" || sprite?.status === "queued";
  const presentation = roderAgentCharacterPresentation(sprite, keyConfigured);

  return (
    <section aria-label="Roder character" className="rounded-xl border border-border p-3">
      <div className="flex items-center gap-3">
        <RoderAgentAvatar id={status.id} sprite={sprite} size={64} />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-medium">Character</h3>
          <p role="status" className="mt-1 text-sm font-normal text-muted-foreground">
            {presentation.description}
          </p>
          {presentation.assetLabel ? (
            <p className="mt-1 text-sm text-muted-foreground">{presentation.assetLabel}</p>
          ) : null}
        </div>
      </div>
      {sprite?.error && sprite.status !== "needs_credentials" ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {sprite.error}
        </p>
      ) : null}
      {presentation.generationNotice ? (
        <p className="mt-3 text-sm font-normal text-muted-foreground">{presentation.generationNotice}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || generating}
          onClick={() => void perform(() => roderAgentsIpc.retrySprite(status.id, "codex"))}
        >
          {sprite?.generationProvider === "codex" ? "Retry with Codex" : "Generate with Codex"}
        </Button>
        {presentation.needsApiKey ? (
          <Button size="sm" variant="outline" onClick={() => setSetupOpen(true)}>
            Set up OpenAI API key
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || generating || presentation.needsApiKey}
          onClick={() => void perform(() => roderAgentsIpc.retrySprite(status.id, "openai"))}
        >
          Generate with OpenAI API
        </Button>
        <p className="text-sm font-normal text-muted-foreground">
          OpenAI API generation is billed separately and requires your API key. It is used only when you choose that
          action.{sprite?.asset ? " Your current character stays visible during retries." : ""}
        </p>
      </div>
      {setupOpen && presentation.needsApiKey ? (
        <RoderAgentImageSetup
          onClose={() => setSetupOpen(false)}
          onConfigured={() => setConfiguredVersion(sprite?.updatedAt ?? null)}
        />
      ) : null}
    </section>
  );
}
