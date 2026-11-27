import { Popover } from "@base-ui/react/popover";
import { Cloud, ExternalLink, Globe2, Network, Pause, Play, RefreshCw, Server } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import type { ActiveRemoteWorkspace, RemoteRunnerStatusSnapshot } from "@/lib/cloud-machines";
import { roderIpc } from "@/lib/roder-ipc";
import { cn } from "@/lib/utils";

export function RemoteRunnerPopover({
  remoteWorkspace,
  onOpenBrowserPreview,
}: {
  remoteWorkspace: ActiveRemoteWorkspace;
  onOpenBrowserPreview?: (url: string) => void;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<RemoteRunnerStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [portInput, setPortInput] = useState("3000");
  const [feedback, setFeedback] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [lastPreviewUrl, setLastPreviewUrl] = useState<string | null>(null);

  async function refreshStatus(): Promise<void> {
    setLoading(true);
    setFeedback(null);
    try {
      const result = await roderIpc.remoteRunnerStatus(remoteWorkspace.workspaceId);
      setSnapshot(result.status);
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not check remote workspace status.",
      });
    } finally {
      setLoading(false);
    }
  }

  useMountEffect(() => {
    void refreshStatus();
  });

  async function handleWake(): Promise<void> {
    setActionBusy("wake");
    setFeedback(null);
    try {
      const result = await roderIpc.wakeRemoteRunner(remoteWorkspace.workspaceId);
      setSnapshot(result.status);
      setFeedback({ kind: "info", text: "Remote sandbox is awake and ready." });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not wake remote sandbox.",
      });
    } finally {
      setActionBusy(null);
    }
  }

  async function handleLifecycle(action: "pause" | "resume"): Promise<void> {
    if (!remoteWorkspace.threadId) return;
    setActionBusy(action);
    setFeedback(null);
    try {
      if (action === "pause") {
        await roderIpc.pauseThreadRunner(remoteWorkspace.threadId);
        setFeedback({ kind: "info", text: "Remote runner paused." });
      } else {
        await roderIpc.resumeThreadRunner(remoteWorkspace.threadId);
        setFeedback({ kind: "info", text: "Remote runner resumed." });
      }
      await refreshStatus();
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : `Could not ${action} remote runner.`,
      });
    } finally {
      setActionBusy(null);
    }
  }

  async function handleSetupTailscale(): Promise<void> {
    setActionBusy("tailscale");
    setFeedback(null);
    try {
      const result = await roderIpc.setupRemoteTailscaleTunnel(remoteWorkspace.workspaceId);
      setSnapshot(result.status);
      setFeedback({
        kind: "info",
        text: result.status.tailscaleIp
          ? `Tailscale tunnel active (${result.status.tailscaleDnsName || result.status.tailscaleIp}).`
          : "Tailscale tunnel is active.",
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not set up Tailscale tunnel.",
      });
    } finally {
      setActionBusy(null);
    }
  }

  async function handleOpenPort(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const port = Number.parseInt(portInput.trim(), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setFeedback({ kind: "error", text: "Enter a valid port between 1 and 65535." });
      return;
    }
    setActionBusy("preview");
    setFeedback(null);
    try {
      const result = await roderIpc.openRemotePreviewPort(remoteWorkspace.workspaceId, port);
      setLastPreviewUrl(result.url);
      if (onOpenBrowserPreview) {
        onOpenBrowserPreview(result.url);
      } else {
        await window.roderDesktop.openExternal(result.url);
      }
      setFeedback({
        kind: "info",
        text:
          result.transport === "tailscale"
            ? `Opened port ${port} over Tailscale.`
            : result.transport === "ssh-forward"
              ? `Opened port ${port} via local SSH tunnel (${result.url}).`
              : `Opened port ${port} preview.`,
      });
    } catch (error) {
      setFeedback({
        kind: "error",
        text: error instanceof Error ? error.message : `Could not open preview for port ${port}.`,
      });
    } finally {
      setActionBusy(null);
    }
  }

  const reachable = snapshot ? snapshot.reachable : true;
  const statusText = snapshot?.status ? formatStatusLabel(snapshot.status) : "Remote";
  const isTailscaleProvider = remoteWorkspace.providerId === "tailscale";
  const isSshProvider = remoteWorkspace.providerId === "ssh";
  const isTailscaleActive = Boolean(snapshot?.tailscaleActive || snapshot?.bridgeMode === "tailscale-tunnel");
  const supportsPortPreview = remoteWorkspace.providerId === "blaxel" || isTailscaleProvider || isSshProvider;

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (open) void refreshStatus();
      }}
    >
      <Popover.Trigger
        className="no-drag flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Remote workspace ${remoteWorkspace.label}: ${statusText}`}
        title={`${remoteWorkspace.providerId} · ${remoteWorkspace.targetName}:${remoteWorkspace.workspacePath}`}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            loading ? "bg-amber-500" : reachable ? "bg-emerald-500" : "bg-destructive",
          )}
        />
        {isTailscaleProvider || isTailscaleActive ? (
          <Network className="size-3.5 shrink-0" />
        ) : isSshProvider ? (
          <Server className="size-3.5 shrink-0" />
        ) : (
          <Cloud className="size-3.5 shrink-0" />
        )}
        <span className="max-w-28 truncate">{remoteWorkspace.label}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={10} className="no-drag z-[110]">
          <Popover.Popup
            aria-label="Remote workspace controls"
            className="w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-popover text-base font-medium text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none"
          >
            <div className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-base font-semibold text-foreground">
                    {isTailscaleProvider || isTailscaleActive ? (
                      <Network className="size-4 shrink-0 text-muted-foreground" />
                    ) : isSshProvider ? (
                      <Server className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Cloud className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{remoteWorkspace.label}</span>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-sm font-normal text-muted-foreground">
                    {remoteWorkspace.workspacePath}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 rounded-md"
                  aria-label="Refresh remote status"
                  disabled={loading}
                  onClick={() => void refreshStatus()}
                >
                  <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
                </Button>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-muted/30 p-3 text-sm">
                <div>
                  <dt className="font-normal text-muted-foreground">Provider</dt>
                  <dd className="text-foreground">
                    {remoteWorkspace.providerId === "ssh"
                      ? "SSH"
                      : remoteWorkspace.providerId.charAt(0).toUpperCase() + remoteWorkspace.providerId.slice(1)}
                  </dd>
                </div>
                <div>
                  <dt className="font-normal text-muted-foreground">Status</dt>
                  <dd className={cn(reachable ? "text-foreground" : "text-destructive")}>{statusText}</dd>
                </div>
                {snapshot?.region && (
                  <div>
                    <dt className="font-normal text-muted-foreground">Region</dt>
                    <dd className="font-mono text-foreground">{snapshot.region}</dd>
                  </div>
                )}
                {snapshot?.blaxelWorkspace && (
                  <div>
                    <dt className="font-normal text-muted-foreground">Workspace</dt>
                    <dd className="truncate font-mono text-foreground">{snapshot.blaxelWorkspace}</dd>
                  </div>
                )}
                {(snapshot?.tailscaleDnsName || snapshot?.tailscaleIp) && (
                  <div className="col-span-2">
                    <dt className="font-normal text-muted-foreground">Tailscale node</dt>
                    <dd className="truncate font-mono text-foreground">
                      {snapshot.tailscaleDnsName || snapshot.tailscaleIp}
                      {snapshot.tailscaleDnsName && snapshot.tailscaleIp ? ` (${snapshot.tailscaleIp})` : ""}
                    </dd>
                  </div>
                )}
                {snapshot?.bridgeMode && (
                  <div className="col-span-2">
                    <dt className="font-normal text-muted-foreground">App-server bridge</dt>
                    <dd className="truncate font-mono text-foreground" title={snapshot.bridgeDetail}>
                      {formatBridgeModeLabel(snapshot.bridgeMode)}
                    </dd>
                  </div>
                )}
              </dl>

              {snapshot?.tailscaleError && !isTailscaleActive && (
                <p className="text-sm font-normal text-muted-foreground">
                  Tailscale fallback: {snapshot.tailscaleError}
                </p>
              )}

              {snapshot?.message && !snapshot.reachable && (
                <p role="alert" className="text-sm font-normal text-destructive">
                  {snapshot.message}
                </p>
              )}

              {feedback && (
                <p
                  role={feedback.kind === "error" ? "alert" : "status"}
                  className={cn(
                    "text-sm font-normal",
                    feedback.kind === "error" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {feedback.text}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {(remoteWorkspace.providerId === "blaxel" || isSshProvider) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-md"
                    disabled={actionBusy !== null}
                    onClick={() => void handleWake()}
                  >
                    <Play className="size-3.5" />
                    {actionBusy === "wake"
                      ? isSshProvider
                        ? "Connecting…"
                        : "Waking…"
                      : isSshProvider
                        ? "Connect tunnel"
                        : "Wake"}
                  </Button>
                )}
                {(((remoteWorkspace.providerId === "blaxel" || isSshProvider) &&
                  snapshot?.tailscaleConfigured &&
                  !isTailscaleActive) ||
                  isTailscaleProvider) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-md"
                    disabled={actionBusy !== null}
                    onClick={() => void handleSetupTailscale()}
                  >
                    <Network className="size-3.5" />
                    {actionBusy === "tailscale"
                      ? "Tunneling…"
                      : isTailscaleProvider
                        ? "Reconnect tunnel"
                        : "Inject Tailscale"}
                  </Button>
                )}
                {remoteWorkspace.threadId && !isTailscaleProvider && !isSshProvider && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-md"
                      disabled={actionBusy !== null}
                      onClick={() => void handleLifecycle("pause")}
                    >
                      <Pause className="size-3.5" />
                      Pause
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-md"
                      disabled={actionBusy !== null}
                      onClick={() => void handleLifecycle("resume")}
                    >
                      <Play className="size-3.5" />
                      Resume
                    </Button>
                  </>
                )}
              </div>

              {supportsPortPreview && (
                <form
                  onSubmit={(event) => void handleOpenPort(event)}
                  className="space-y-2 border-t border-border/70 pt-3"
                >
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Globe2 className="size-3.5" />
                    <span>
                      Preview remote port
                      {isTailscaleProvider || isTailscaleActive
                        ? " (via Tailscale)"
                        : isSshProvider
                          ? " (via SSH tunnel)"
                          : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label="Remote port number"
                      value={portInput}
                      onChange={(event) => setPortInput(event.currentTarget.value)}
                      placeholder="3000"
                      className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 font-mono text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="rounded-md"
                      disabled={actionBusy !== null}
                    >
                      {actionBusy === "preview" ? "Opening…" : "Open"}
                    </Button>
                  </div>
                  {lastPreviewUrl && (
                    <button
                      type="button"
                      className="flex items-center gap-1 truncate text-sm font-normal text-muted-foreground hover:text-foreground"
                      onClick={() => void window.roderDesktop.openExternal(lastPreviewUrl)}
                    >
                      <ExternalLink className="size-3 shrink-0" />
                      <span className="truncate font-mono">{lastPreviewUrl}</span>
                    </button>
                  )}
                </form>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function formatBridgeModeLabel(mode: NonNullable<RemoteRunnerStatusSnapshot["bridgeMode"]>): string {
  if (mode === "tailscale-tunnel") return "Tailscale WireGuard tunnel";
  if (mode === "ssh-tunnel") return "remote-roder (SSH tunnel)";
  if (mode === "remote-roder-tunnel") return "remote-roder (WSS tunnel)";
  if (mode === "tailscale-ssh") return "Tailscale SSH bridge";
  if (mode === "ssh-direct") return "SSH bridge";
  if (mode === "blaxel-api") return "Blaxel API fallback";
  return "Ready to connect";
}

function formatStatusLabel(raw: string): string {
  const upper = raw.toUpperCase();
  if (upper === "DEPLOYED") return "Ready";
  if (upper === "STANDBY") return "Standby";
  if (upper === "DEPLOYING" || upper === "CREATING") return "Starting";
  return raw.slice(0, 1).toUpperCase() + raw.slice(1).toLowerCase();
}
