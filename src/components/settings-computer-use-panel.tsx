import { ChevronLeft, Globe, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useComputerUseStore,
  type ComputerUseDomainList,
  type ComputerUsePermission,
  type ComputerUsePermissionKey,
} from "@/stores/computer-use-store";
import type { ChromeBridgeStatus } from "@/types/roder";
import { cn } from "@/lib/utils";

// Live enablement state from roder's `chrome/status` (separate from the local
// bridge connection state exposed via `chromeBridge*`). `connected` mirrors the
// bridge `clientCount`/`running` state; `enabled` is the roder-side toggle.
type ChromeStatus = {
  connected: boolean;
  clientCount: number;
  enabled: boolean;
  mode?: "observe" | "assist" | "control";
  lastError?: string | null;
};

const defaultChromeStatus: ChromeStatus = {
  connected: false,
  clientCount: 0,
  enabled: false,
};

function parseChromeStatus(value: unknown): ChromeStatus {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    connected: Boolean(record.connected),
    clientCount: typeof record.clientCount === "number" ? record.clientCount : 0,
    enabled: Boolean(record.enabled),
    mode: record.mode as ChromeStatus["mode"],
    lastError: typeof record.lastError === "string" ? record.lastError : null,
  };
}

type PanelView = "overview" | "chrome";

export function SettingsComputerUsePanel(): React.JSX.Element {
  // Both screens live inside this panel and switch with local state — there is
  // no settings sub-route in this codebase, so "Manage" / "Back" flip the view.
  const [view, setView] = useState<PanelView>("overview");
  const [bridge, setBridge] = useState<ChromeBridgeStatus | null>(null);
  const [chrome, setChrome] = useState<ChromeStatus>(defaultChromeStatus);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshChrome(): Promise<void> {
    try {
      const status = await window.roderDesktop.request("chrome/status");
      setChrome(parseChromeStatus(status));
    } catch (err) {
      // chrome/status may be unavailable in some builds; fall back to bridge.
      setChrome((prev) => ({ ...prev, lastError: (err as Error).message }));
    }
  }

  useEffect(() => {
    let mounted = true;
    void window.roderDesktop
      .chromeBridgeStatus()
      .then((status) => mounted && setBridge(status))
      .catch((err) => mounted && setError((err as Error).message))
      .finally(() => mounted && setLoading(false));
    void refreshChrome();
    const off = window.roderDesktop.onChromeBridgeStatus((status) => {
      setBridge(status);
      void refreshChrome();
    });
    return () => {
      mounted = false;
      off();
    };
  }, []);

  // Real connection status: prefer roder's `chrome/status.connected`, fall back
  // to the live bridge running + client count when chrome/status is unavailable.
  const connected = chrome.connected || (bridge?.state === "running" && bridge.clientCount > 0);
  const enabled = chrome.enabled || bridge?.state === "running";

  async function setEnabled(next: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await window.roderDesktop.request(next ? "chrome/enable" : "chrome/disable");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      await refreshChrome();
      setBusy(false);
    }
  }

  async function reinstall(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setBridge(await window.roderDesktop.chromeBridgeRestart());
      await window.roderDesktop.chromeBridgeOpenExtensionOptions();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      await refreshChrome();
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm("Remove the Roder Chrome extension connection? You can reconnect it at any time.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setBridge(await window.roderDesktop.chromeBridgeStop());
      await window.roderDesktop.request("chrome/disable").catch(() => undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      await refreshChrome();
      setBusy(false);
    }
  }

  if (view === "chrome") {
    return (
      <ChromeDetailScreen
        connected={connected}
        busy={busy}
        error={error ?? chrome.lastError ?? null}
        onBack={() => setView("overview")}
        onReinstall={() => void reinstall()}
        onRemove={() => void remove()}
      />
    );
  }

  return (
    <ComputerUseOverviewScreen
      connected={connected}
      enabled={enabled}
      loading={loading}
      busy={busy}
      error={error}
      onManage={() => setView("chrome")}
      onToggleEnabled={(next) => void setEnabled(next)}
    />
  );
}

function ComputerUseOverviewScreen({
  connected,
  enabled,
  loading,
  busy,
  error,
  onManage,
  onToggleEnabled,
}: {
  connected: boolean;
  enabled: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  onManage: () => void;
  onToggleEnabled: (next: boolean) => void;
}): React.JSX.Element {
  const allowedDomains = useComputerUseStore((state) => state.allowedDomains);

  const subtitle = loading
    ? "Checking connection…"
    : connected
      ? "Connected to browser extension for additional control"
      : enabled
        ? "Extension not paired"
        : "Not connected";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-medium">Computer use</h1>
        <p className="mt-1 text-base text-muted-foreground">Manage how Roder uses your browser and apps.</p>
      </header>

      <section className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
        <header className="border-b border-border px-5 py-3">
          <h2 className="text-base font-medium">Control</h2>
        </header>
        <div className="px-5">
          <div className="flex min-h-14 items-center gap-4 py-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Globe className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base text-foreground">Google Chrome</div>
              <div className="mt-0.5 flex items-center gap-2 text-base text-muted-foreground">
                <span
                  className={cn(
                    "inline-block size-1.5 rounded-full",
                    connected ? "bg-emerald-500" : "bg-muted-foreground/50",
                  )}
                />
                {subtitle}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={onManage}>
                Manage
              </Button>
              <Switch
                ariaLabel="Enable Google Chrome computer use"
                checked={enabled}
                disabled={busy || loading}
                onChange={onToggleEnabled}
              />
            </div>
          </div>
        </div>
        {error && (
          <div className="border-t border-border px-5 py-3">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-base text-destructive">
              {error}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
        <header className="border-b border-border px-5 py-3">
          <h2 className="text-base font-medium">Allowed sites</h2>
          <p className="mt-0.5 text-base text-muted-foreground">Sites Roder may open in your browser without asking.</p>
        </header>
        {allowedDomains.length === 0 ? (
          <div className="px-5 py-8 text-center text-base text-muted-foreground">None yet</div>
        ) : (
          <ul className="divide-y divide-border px-5">
            {allowedDomains.map((domain) => (
              <li key={domain} className="flex items-center py-3 text-base text-foreground">
                {domain}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ChromeDetailScreen({
  connected,
  busy,
  error,
  onBack,
  onReinstall,
  onRemove,
}: {
  connected: boolean;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onReinstall: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <div className="space-y-6">
      <button
        type="button"
        className="flex items-center gap-1.5 text-base text-muted-foreground transition-colors hover:text-foreground"
        onClick={onBack}
      >
        <ChevronLeft className="size-4" />
        <span>Back</span>
        <span className="text-muted-foreground/60">·</span>
        <span>Computer use</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="text-foreground">Google Chrome</span>
      </button>

      <header className="flex items-start justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Globe className="size-6" />
          </div>
          <div>
            <h1 className="text-lg font-medium">Google Chrome</h1>
            <div className="mt-1 flex items-center gap-1.5 text-base">
              <span
                className={cn("text-base leading-none", connected ? "text-emerald-500" : "text-muted-foreground/60")}
              >
                ●
              </span>
              <span className="text-muted-foreground">{connected ? "Connected" : "Not connected"}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={onReinstall}>
            <RefreshCw className="size-3.5" />
            Reinstall extension
          </Button>
          <Button variant="warning" size="sm" disabled={busy} onClick={onRemove}>
            Remove extension
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-base text-destructive">
          {error}
        </div>
      )}

      <PermissionsCard />

      <DomainListCard
        title="Blocked domains"
        description="Roder will never open these sites in your browser."
        emptyState="No blocked domains"
        list="blockedDomains"
      />
      <DomainListCard
        title="Allowed domains"
        description="Domains that open without asking."
        emptyState="No allowed domains"
        list="allowedDomains"
      />
      <DomainListCard
        title="Blocked download domains"
        description="Roder will never download files from these sites."
        emptyState="No blocked download domains"
        list="blockedDownloadDomains"
      />
      <DomainListCard
        title="Allowed download domains"
        description="Downloads from these domains are allowed without asking."
        emptyState="No allowed download domains"
        list="allowedDownloadDomains"
      />
      <DomainListCard
        title="Blocked upload domains"
        description="Roder will never upload files to these sites."
        emptyState="No blocked upload domains"
        list="blockedUploadDomains"
      />
      <DomainListCard
        title="Allowed upload domains"
        description="Uploads to these domains are allowed without asking."
        emptyState="No allowed upload domains"
        list="allowedUploadDomains"
      />
    </div>
  );
}

const permissionRows: Array<{ key: ComputerUsePermissionKey; label: string; description: string }> = [
  { key: "approval", label: "Approval", description: "Ask for approval before opening websites." },
  { key: "history", label: "History", description: "Ask before accessing your browser history." },
  { key: "downloads", label: "Downloads", description: "Ask before downloading files from websites." },
  { key: "uploads", label: "Uploads", description: "Ask before uploading files to websites." },
];

const permissionItems: Record<ComputerUsePermission, string> = {
  allow: "Always allow",
  ask: "Ask",
  never: "Never",
};

function PermissionsCard(): React.JSX.Element {
  const permissions = useComputerUseStore((state) => state.permissions);
  const setPermission = useComputerUseStore((state) => state.setPermission);

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
      <header className="border-b border-border px-5 py-3">
        <h2 className="text-base font-medium">Permissions</h2>
      </header>
      <div className="divide-y divide-border px-5">
        {permissionRows.map((row) => (
          <div key={row.key} className="flex min-h-14 items-center gap-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-base text-foreground">{row.label}</div>
              <div className="mt-0.5 text-base text-muted-foreground">{row.description}</div>
            </div>
            <Select
              items={permissionItems}
              value={permissions[row.key]}
              onValueChange={(value) => setPermission(row.key, (value ?? "ask") as ComputerUsePermission)}
            >
              <SelectTrigger className="w-[160px] border border-border bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(Object.keys(permissionItems) as ComputerUsePermission[]).map((option) => (
                    <SelectItem key={option} value={option}>
                      {permissionItems[option]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
    </section>
  );
}

function DomainListCard({
  title,
  description,
  emptyState,
  list,
}: {
  title: string;
  description: string;
  emptyState: string;
  list: ComputerUseDomainList;
}): React.JSX.Element {
  const domains = useComputerUseStore((state) => state[list]);
  const addDomain = useComputerUseStore((state) => state.addDomain);
  const removeDomain = useComputerUseStore((state) => state.removeDomain);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const inputId = useMemo(() => `add-domain-${list}`, [list]);

  useEffect(() => {
    if (adding) {
      inputRef.current?.focus();
    }
  }, [adding]);

  function commit(): void {
    const value = draft.trim();
    if (value) {
      addDomain(list, value);
    }
    setDraft("");
    setAdding(false);
  }

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium">{title}</h2>
          <p className="mt-0.5 text-base text-muted-foreground">{description}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => {
            setAdding(true);
            setDraft("");
          }}
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </header>

      {adding && (
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <input
            ref={inputRef}
            id={inputId}
            value={draft}
            aria-label={`Add ${title.toLowerCase()}`}
            placeholder="example.com"
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commit();
              } else if (event.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
          />
          <Button variant="accent" size="sm" disabled={!draft.trim()} onClick={commit}>
            Add
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft("");
              setAdding(false);
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {domains.length === 0 ? (
        <div className="px-5 py-8 text-center text-base text-muted-foreground">{emptyState}</div>
      ) : (
        <ul className="divide-y divide-border px-5">
          {domains.map((domain) => (
            <li key={domain} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{domain}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${domain}`}
                onClick={() => removeDomain(list, domain)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Switch({
  ariaLabel,
  checked,
  disabled,
  onChange,
}: {
  ariaLabel: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={checked}
      disabled={disabled}
      className={cn(
        "relative h-6 w-10 shrink-0 overflow-hidden rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted",
      )}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          "absolute left-0 top-1 size-4 rounded-full bg-white transition-transform",
          checked ? "translate-x-5" : "translate-x-1",
        )}
      />
    </button>
  );
}
