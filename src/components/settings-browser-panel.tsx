import { Check, Monitor, Copy, ExternalLink, Plug, Power, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ChromeBridgeStatus } from "@/types/roder";
import { cn } from "@/lib/utils";

const stoppedStatus: ChromeBridgeStatus = {
  state: "stopped",
  url: null,
  token: null,
  tokenPreview: null,
  pairingUrl: null,
  pid: null,
  clientCount: 0,
};

export function SettingsBrowserPanel(): React.JSX.Element {
  const [status, setStatus] = useState<ChromeBridgeStatus>(stoppedStatus);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"url" | "token" | "pairing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.roderDesktop
      .chromeBridgeStatus()
      .then((nextStatus) => mounted && setStatus(nextStatus))
      .catch((err) => mounted && setError((err as Error).message));
    const off = window.roderDesktop.onChromeBridgeStatus((nextStatus) => setStatus(nextStatus));
    return () => {
      mounted = false;
      off();
    };
  }, []);

  const running = status.state === "running";
  const primaryLabel = useMemo(() => {
    if (status.state === "starting") return "Starting";
    return running ? "Turn off bridge" : "Turn on bridge";
  }, [running, status.state]);

  async function run(action: () => Promise<ChromeBridgeStatus>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string | null, key: "url" | "token" | "pairing"): Promise<void> {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1400);
  }

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <header className="flex items-start justify-between gap-6 border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Monitor className="size-4" />
            <h1 className="text-base font-medium">Browser bridge</h1>
          </div>
          <p className="mt-1 max-w-[660px] text-base text-muted-foreground">
            Let the Roder Chrome extension connect to this desktop app, show browser activity, and collaborate with the
            active agent. This mirrors the Claude Desktop connector pattern: enable a local bridge here, then connect the
            browser extension to the local endpoint.
          </p>
        </div>
        <BridgeStatePill state={status.state} />
      </header>

      <div className="divide-y divide-border px-5">
        <SettingsRow label="Remote bridge" description="Starts a local authenticated WebSocket bridge for Chrome.">
          <Button
            variant={running ? "warning" : "accent"}
            size="sm"
            disabled={busy || status.state === "starting"}
            onClick={() => void run(running ? window.roderDesktop.chromeBridgeStop : window.roderDesktop.chromeBridgeStart)}
          >
            {running ? <Power className="size-3.5" /> : <Plug className="size-3.5" />}
            {busy ? "Working" : primaryLabel}
          </Button>
        </SettingsRow>

        <SettingsRow label="Connection URL" description="Paste this into the Roder Browser Bridge extension endpoint field.">
          <CopyField value={status.url} placeholder="Start the bridge to create a URL" copied={copied === "url"} onCopy={() => void copy(status.url, "url")} />
        </SettingsRow>

        <SettingsRow label="Bearer token" description="Paste this into the extension token field. It changes each time the bridge starts.">
          <CopyField value={status.token} secret placeholder="Start the bridge to create a token" copied={copied === "token"} onCopy={() => void copy(status.token, "token")} />
        </SettingsRow>

        <SettingsRow label="Pairing link" description="For future deep-link pairing support; currently useful for debugging.">
          <CopyField value={status.pairingUrl} placeholder="Unavailable until the bridge is running" copied={copied === "pairing"} onCopy={() => void copy(status.pairingUrl, "pairing")} />
        </SettingsRow>
      </div>

      <div className="space-y-4 border-t border-border px-5 py-4">
        <div className="rounded-xl border border-border bg-background/60 p-4">
          <div className="flex items-center gap-2 text-base font-medium">
            <ShieldCheck className="size-4 text-emerald-500" />
            How to connect Chrome
          </div>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-base text-muted-foreground">
            <li>Build and load the extension from <span className="font-mono text-foreground">../roder-chrome/dist</span>.</li>
            <li>Turn on the bridge above.</li>
            <li>Open the extension options page and paste the URL and token from this screen.</li>
            <li>Click Connect in the extension. The side panel becomes the live chat and outputs view.</li>
          </ol>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void run(window.roderDesktop.chromeBridgeRestart)} disabled={busy}>
            <RefreshCw className="size-3.5" />
            Regenerate token
          </Button>
          <Button variant="outline" size="sm" onClick={() => void window.roderDesktop.chromeBridgeOpenExtensionOptions()}>
            <ExternalLink className="size-3.5" />
            Open Chrome extension settings
          </Button>
        </div>

        {(error || status.message || status.lastEvent) && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-base text-destructive">
            {error ?? status.message ?? status.lastEvent}
          </div>
        )}
      </div>
    </section>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-h-14 items-center gap-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-base text-foreground">{label}</div>
        {description && <div className="mt-0.5 max-w-[520px] text-base text-muted-foreground">{description}</div>}
      </div>
      {children}
    </div>
  );
}

function BridgeStatePill({ state }: { state: ChromeBridgeStatus["state"] }): React.JSX.Element {
  return (
    <span
      className={cn(
        "rounded-full px-3 py-1 text-sm font-medium capitalize",
        state === "running"
          ? "bg-emerald-100 text-emerald-700"
          : state === "starting"
            ? "bg-blue-100 text-blue-700"
            : state === "error"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground",
      )}
    >
      {state}
    </span>
  );
}

function CopyField({
  value,
  placeholder,
  copied,
  secret = false,
  onCopy,
}: {
  value: string | null;
  placeholder: string;
  copied: boolean;
  secret?: boolean;
  onCopy: () => void;
}): React.JSX.Element {
  return (
    <div className="flex w-[380px] items-center gap-2">
      <input
        readOnly
        type={secret ? "password" : "text"}
        value={value ?? ""}
        placeholder={placeholder}
        className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground outline-none"
      />
      <Button variant="outline" size="icon-xs" disabled={!value} onClick={onCopy} aria-label="Copy value">
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

