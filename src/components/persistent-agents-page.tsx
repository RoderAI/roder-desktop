import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { Button } from "@/components/ui/button";
import { PersistentAgentCreateDialog } from "@/components/persistent-agent-create-dialog";
import { PersistentAgentAvatar } from "@/components/persistent-agent-avatar";
import { PersistentAgentImageSetup } from "@/components/persistent-agent-image-setup";
import { persistentAgentsIpc } from "@/lib/persistent-agents-ipc";
import { persistentAgentCharacterPresentation } from "@/lib/persistent-agent-character";
import { roderIpc } from "@/lib/roder-ipc";
import { cn } from "@/lib/utils";
import type { PersistentAgent, PersistentAgentDetail } from "@/types/persistent-agents";
import type { RoderModel, Workspace } from "@/types/roder";

const fieldClass =
  "w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PersistentAgentsPage({
  create = false,
  onCreateHandled,
}: { create?: boolean; onCreateHandled?: () => void } = {}) {
  const [persistentAgents, setPersistentAgents] = useState<PersistentAgent[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<PersistentAgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [models, setModels] = useState<RoderModel[]>([]);
  const [observedAt, setObservedAt] = useState(() => Date.now());

  async function refresh() {
    const result = await persistentAgentsIpc.list();
    setPersistentAgents(result.persistentAgents);
    setObservedAt(Date.now());
  }
  useMountEffect(() => {
    let mounted = true;
    void Promise.all([persistentAgentsIpc.list(), window.roderDesktop.request("workspace/list", {})])
      .then(([result, spaces]) => {
        if (!mounted) return;
        setPersistentAgents(result.persistentAgents);
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
      if (mounted && notification.method === "desktop/persistent-agents/changed")
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
          <h1 className="font-semibold">Persistent Agents (PAs)</h1>
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
            <h2 className="font-semibold">Your persistent agents</h2>
            {persistentAgents.length === 0 ? (
              <p className="text-muted-foreground font-normal">
                Create a persistent agent for a project you want to keep moving.
              </p>
            ) : (
              <ul className="space-y-1">
                {persistentAgents.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex h-11 w-full items-center gap-2.5 rounded-xl px-2 text-left hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring",
                        selected?.id === c.id && "bg-accent/60",
                      )}
                      onClick={async () => {
                        const persistentAgent = await perform(() => persistentAgentsIpc.read(c.id));
                        if (persistentAgent) setSelected(persistentAgent);
                      }}
                    >
                      <PersistentAgentAvatar id={c.id} sprite={c.sprite} />
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
            <PersistentAgentCreateDialog
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
                const persistentAgent = await perform(() => persistentAgentsIpc.create(params));
                if (!persistentAgent) return false;
                setSelected(persistentAgent);
                return true;
              }}
            />
          </section>
          <section className="lg:col-span-2">
            {selected ? (
              <PersistentAgentEditor
                key={`${selected.id}:${selected.memory}`}
                initial={selected}
                status={persistentAgents.find((c) => c.id === selected.id) ?? selected}
                busy={busy}
                observedAt={observedAt}
                perform={perform}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-border p-4 text-muted-foreground font-normal">
                Select a persistent agent to edit its memory and opt in to proactive work.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function PersistentAgentEditor({
  initial,
  status,
  busy,
  observedAt,
  perform,
}: {
  initial: PersistentAgentDetail;
  status: PersistentAgent;
  busy: boolean;
  observedAt: number;
  perform: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const memoryVersion = useRef(initial.memory);
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{status.name}</h2>
        <Link
          to="/threads/$threadId"
          params={{ threadId: status.threadId }}
          className="rounded-md px-3 py-2 underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open persistent agent thread
        </Link>
      </header>
      <p className="text-sm text-muted-foreground">
        Local device · {status.model ? `${status.model} · ${status.modelProvider}` : "Engine default model"}
        {status.reasoning ? ` · ${status.reasoning} reasoning` : ""}
      </p>
      <PersistentAgentCharacter status={status} busy={busy} perform={perform} />
      <div className="rounded-xl border border-border p-3 space-y-3">
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
                await persistentAgentsIpc.update({ id: status.id, enabled: !status.enabled });
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
                await persistentAgentsIpc.run(status.id);
              })
            }
          >
            Run once
          </Button>
          <Button
            disabled={busy || !!status.active}
            variant="outline"
            onClick={async () => {
              const result = await perform(() => persistentAgentsIpc.compact(status.id));
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
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const saved = await perform(() =>
            persistentAgentsIpc.update({
              id: status.id,
              name: String(data.get("name")),
              mission: String(data.get("mission")),
              memory: String(data.get("memory")),
              expectedMemory: memoryVersion.current,
              intervalMinutes: Number(data.get("interval")),
              maxRunsPerDay: Number(data.get("runs")),
              maxRunMinutes: Number(data.get("minutes")),
              eventMethods: String(data.get("events"))
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            }),
          );
          if (saved) {
            memoryVersion.current = saved.memory;
            setMessage("Memory and controls saved.");
          }
        }}
      >
        <label className="block space-y-1">
          <span>Name</span>
          <input name="name" defaultValue={initial.name} required maxLength={120} className={fieldClass} />
        </label>
        <label className="block space-y-1">
          <span>Mission</span>
          <textarea
            name="mission"
            defaultValue={initial.mission}
            required
            rows={3}
            maxLength={16000}
            className={fieldClass}
          />
        </label>
        <label className="block space-y-1">
          <span>Durable memory</span>
          <textarea
            name="memory"
            defaultValue={initial.memory}
            rows={9}
            maxLength={32000}
            className={`${fieldClass} font-normal`}
          />
          <span className="block break-all text-sm text-muted-foreground">{initial.memoryPath}</span>
        </label>
        <p className="text-sm text-muted-foreground font-normal">
          This editable file is loaded on every wake. Reopen the persistent agent before editing if its agent has
          updated memory. It is a compact reference, not a replacement for thread history.
        </p>
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
          Save memory and controls
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
                      await persistentAgentsIpc.cancelWake(status.id, w.id);
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
              await persistentAgentsIpc.schedule(
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

function PersistentAgentCharacter({
  status,
  busy,
  perform,
}: {
  status: PersistentAgent;
  busy: boolean;
  perform: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}): React.JSX.Element {
  const [setupOpen, setSetupOpen] = useState(false);
  const [configuredVersion, setConfiguredVersion] = useState<number | null>(null);
  const sprite = status.sprite;
  const keyConfigured = configuredVersion !== null && configuredVersion === sprite?.updatedAt;
  const generating = sprite?.status === "generating" || sprite?.status === "queued";
  const presentation = persistentAgentCharacterPresentation(sprite, keyConfigured);

  return (
    <section aria-label="PA character" className="rounded-xl border border-border p-3">
      <div className="flex items-center gap-3">
        <PersistentAgentAvatar id={status.id} sprite={sprite} size={64} />
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
          onClick={() => void perform(() => persistentAgentsIpc.retrySprite(status.id, "codex"))}
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
          onClick={() => void perform(() => persistentAgentsIpc.retrySprite(status.id, "openai"))}
        >
          Generate with OpenAI API
        </Button>
        <p className="text-sm font-normal text-muted-foreground">
          OpenAI API generation is billed separately and requires your API key. It is used only when you choose that
          action.{sprite?.asset ? " Your current character stays visible during retries." : ""}
        </p>
      </div>
      {setupOpen && presentation.needsApiKey ? (
        <PersistentAgentImageSetup
          onClose={() => setSetupOpen(false)}
          onConfigured={() => setConfiguredVersion(sprite?.updatedAt ?? null)}
        />
      ) : null}
    </section>
  );
}
