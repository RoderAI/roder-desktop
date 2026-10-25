import { ClipboardCopy, ExternalLink, KeyRound, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import {
  errorMessage,
  primaryActionClassName,
  StatusPill,
  withDeadline,
} from "@/components/onboarding/onboarding-primitives";
import { Button } from "@/components/ui/button";
import { oauthLoginMethods, providerSetupKind } from "@/lib/onboarding";
import { authTypeLabel, providerCopy } from "@/lib/provider-copy";
import { providerName } from "@/lib/roder-models";
import { cn } from "@/lib/utils";
import { roderIpc } from "@/lib/roder-ipc";
import { useRoderStore } from "@/stores/roder-store";
import type { ClaudeCliStatus, ProviderDescriptor } from "@/types/roder";

const CODEX_POLL_INTERVAL_MS = 1500;
const CODEX_SIGN_IN_TIMEOUT_MS = 3 * 60 * 1000;
const OAUTH_SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const OAUTH_TIMEOUT_MESSAGE = "Sign-in did not finish. Try again.";

export function ProviderConnectCard({
  provider,
  ready,
  environmentVar,
  claudeCli,
  onRecheckClaudeCli,
  onError,
}: {
  provider: ProviderDescriptor;
  ready: boolean;
  environmentVar?: string;
  claudeCli: ClaudeCliStatus | null;
  onRecheckClaudeCli: () => Promise<void>;
  onError: (message: string | null) => void;
}): React.JSX.Element {
  const kind = providerSetupKind(provider);
  const copy = providerCopy[provider.id];
  const title = copy?.title ?? (provider.name || providerName(provider.id));
  const description = copy?.description ?? provider.description ?? "";
  const baseMethod = copy?.method ?? authTypeLabel(provider.authType);
  const method = environmentVar ? `${baseMethod} · ${environmentVar}` : baseMethod;

  const refreshProviders = useRoderStore((state) => state.refreshProviders);
  const configureProvider = useRoderStore((state) => state.configureProvider);
  const restart = useRoderStore((state) => state.restart);

  const [pending, setPending] = useState<"codex" | "oauth" | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  function reportError(message: string | null): void {
    setCardError(message);
    onError(message);
  }

  useEffect(() => {
    if (pending !== "codex") {
      return;
    }
    // The desktop learns about a Codex sign-in only by polling: the detached login process reports nothing.
    // roderSignedIn is the Roder token store. codexSignedIn would also match an existing Codex CLI login.
    let cancelled = false;
    const startedAt = Date.now();
    const fail = (message: string) => {
      setCardError(message);
      onError(message);
    };
    const timer = window.setInterval(() => {
      void window.roderDesktop
        .codexAccount()
        .then(async (account) => {
          if (cancelled) {
            return;
          }
          if (account.roderSignedIn) {
            setPending(null);
            try {
              await refreshProviders();
            } catch (refreshError) {
              fail(errorMessage(refreshError));
            }
            return;
          }
          const timedOut = Date.now() - startedAt > CODEX_SIGN_IN_TIMEOUT_MS;
          if (!account.loginPending || timedOut) {
            setPending(null);
            if (account.loginPending) {
              // Stop the stalled login so a retry can start a new one.
              await window.roderDesktop.codexCancelLogin().catch(() => undefined);
            }
            fail("Sign-in did not finish. Try again.");
          }
        })
        .catch(() => undefined);
    }, CODEX_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pending, refreshProviders, onError]);

  async function signInWithCodex(): Promise<void> {
    reportError(null);
    setPending("codex");
    try {
      await window.roderDesktop.codexLogin();
    } catch (loginError) {
      setPending(null);
      reportError(errorMessage(loginError));
    }
  }

  async function signInWithOAuth(): Promise<void> {
    const method = oauthLoginMethods[provider.id];
    if (!method) {
      return;
    }
    reportError(null);
    setPending("oauth");
    try {
      // The backend holds this request until the browser approval completes, and it has no deadline of its own.
      await withDeadline(roderIpc.startProviderOAuth(method), OAUTH_SIGN_IN_TIMEOUT_MS, OAUTH_TIMEOUT_MESSAGE);
      await refreshProviders();
    } catch (loginError) {
      reportError(errorMessage(loginError));
    } finally {
      setPending(null);
    }
  }

  async function saveApiKey(): Promise<void> {
    const trimmed = apiKey.trim();
    if (!trimmed || saving) {
      return;
    }
    reportError(null);
    setSaving(true);
    try {
      await configureProvider(provider.id, trimmed);
      setApiKey("");
      // Some engines read their key once at startup, so restart to pick it up.
      await restart();
      // The store's restart action reports failure through its error field rather than throwing.
      const restartError = useRoderStore.getState().error;
      if (restartError) {
        throw new Error(restartError);
      }
      await refreshProviders();
    } catch (saveError) {
      reportError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <article
      aria-label={title}
      className={cn(
        "flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 transition-colors duration-200",
        ready ? "ring-primary/30" : "ring-border/70",
      )}
    >
      <header className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted/50">
          <ProviderLogo provider={provider.id} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-medium">{title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{method}</p>
        </div>
        <StatusPill
          ready={ready}
          readyLabel={environmentVar ? "From environment" : "Connected"}
          idleLabel="Not connected"
        />
      </header>

      {description && <p className="text-base text-muted-foreground">{description}</p>}

      {kind === "api-key" && copy?.apiKeyUrl && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 self-start rounded-md text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            reportError(null);
            window.roderDesktop.openExternal(copy.apiKeyUrl ?? "").catch((linkError: unknown) => {
              reportError(errorMessage(linkError));
            });
          }}
        >
          Get an API key from {title}
          <ExternalLink className="size-3.5" />
        </button>
      )}

      {kind === "claude-cli" && <ClaudeCliNote claudeCli={claudeCli} ready={ready} onRecheck={onRecheckClaudeCli} />}

      {kind === "codex-login" && (
        <div className="flex flex-col gap-3">
          {ready ? (
            <p className="text-base text-muted-foreground">Signed in. Models from your plan are now available.</p>
          ) : pending === "codex" ? (
            <PendingNote message="Finish signing in with ChatGPT in your browser. This card updates when you're done." />
          ) : (
            <Button className={cn("self-start", primaryActionClassName)} onClick={() => void signInWithCodex()}>
              {copy?.signInLabel ?? "Sign in"}
            </Button>
          )}
        </div>
      )}

      {kind === "oauth-rpc" && (
        <div className="flex flex-col gap-3">
          {ready ? (
            <p className="text-base text-muted-foreground">Signed in. Models from your plan are now available.</p>
          ) : pending === "oauth" ? (
            <PendingNote message="Approve Roder in the browser window that opened. This card updates when you're done." />
          ) : (
            <Button
              className={cn("self-start", primaryActionClassName)}
              disabled={pending !== null}
              onClick={() => void signInWithOAuth()}
            >
              {copy?.signInLabel ?? "Sign in"}
            </Button>
          )}
        </div>
      )}

      {kind === "api-key" && (
        <div className="flex items-center gap-2">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-background px-3 ring-1 ring-border/70 focus-within:ring-ring">
            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              aria-label={`${title} API key`}
              placeholder={provider.authLabel ? `Paste ${provider.authLabel}` : "Paste API key"}
              disabled={saving}
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground disabled:opacity-50"
              onChange={(event) => setApiKey(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void saveApiKey();
                }
              }}
            />
          </label>
          <Button
            className={primaryActionClassName}
            disabled={saving || apiKey.trim().length === 0}
            onClick={() => void saveApiKey()}
          >
            {saving ? "Saving..." : ready ? "Update" : "Save key"}
          </Button>
        </div>
      )}

      {kind === "settings" && (
        <p className="text-base text-muted-foreground">
          {ready ? "Available without extra setup." : `Set up ${title} from Settings > Providers.`}
        </p>
      )}

      {cardError && (
        <p role="alert" className="text-base text-destructive">
          {cardError}
        </p>
      )}
    </article>
  );
}

function PendingNote({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-muted/40 p-3">
      <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
      <p className="text-base text-muted-foreground">{message}</p>
    </div>
  );
}

function ClaudeCliNote({
  claudeCli,
  ready,
  onRecheck,
}: {
  claudeCli: ClaudeCliStatus | null;
  ready: boolean;
  onRecheck: () => Promise<void>;
}): React.JSX.Element {
  const [checking, setChecking] = useState(false);

  async function recheck(): Promise<void> {
    setChecking(true);
    try {
      await onRecheck();
    } finally {
      setChecking(false);
    }
  }

  if (claudeCli === null) {
    return <p className="text-base text-muted-foreground">Checking for Claude Code...</p>;
  }

  if (claudeCli.installed && !claudeCli.onPath) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-base text-muted-foreground">
          Found Claude Code at <span className="font-mono text-sm">{claudeCli.path}</span>, but Roder cannot launch it
          from its current PATH yet. Add that folder to your PATH and reopen Roder.
        </p>
        <Button variant="ghost" className="self-start" disabled={checking} onClick={() => void recheck()}>
          <RefreshCw className={cn("size-4", checking && "animate-spin motion-reduce:animate-none")} />
          Check again
        </Button>
      </div>
    );
  }

  if (claudeCli.installed && !claudeCli.runnable) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-base text-muted-foreground">
          Found Claude Code at <span className="font-mono text-sm">{claudeCli.path}</span>, but it did not start. Run{" "}
          <code className="font-mono text-sm">claude</code> in a terminal to see the error, then check again.
        </p>
        <Button variant="ghost" className="self-start" disabled={checking} onClick={() => void recheck()}>
          <RefreshCw className={cn("size-4", checking && "animate-spin motion-reduce:animate-none")} />
          Check again
        </Button>
      </div>
    );
  }

  if (ready) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-base text-muted-foreground">
          Claude Code is installed. If you have not signed in yet, run <code className="font-mono text-sm">claude</code>{" "}
          in a terminal once and complete the login.
        </p>
        <Button variant="ghost" className="self-start" onClick={() => void navigator.clipboard?.writeText("claude")}>
          <ClipboardCopy className="size-4" />
          Copy command
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-muted-foreground">
        Install Claude Code, then run <code className="font-mono text-sm">claude</code> once in a terminal to sign in.
        Roder uses that session and never asks for your Claude password.
      </p>
      <Button variant="ghost" className="self-start" disabled={checking} onClick={() => void recheck()}>
        <RefreshCw className={cn("size-4", checking && "animate-spin motion-reduce:animate-none")} />
        Check again
      </Button>
    </div>
  );
}
