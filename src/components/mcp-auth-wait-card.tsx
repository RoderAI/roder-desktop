import { Check, Key, Loader2, PlugZap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { McpAuthWaitRequest } from "@/types/roder";

type McpAuthWaitCardsProps = {
  requests: McpAuthWaitRequest[];
  onSkip: (id: string) => Promise<void>;
  onApiKeySubmit: (id: string, apiKey: string) => Promise<void>;
  onOAuthStart: (id: string, url: string) => Promise<void>;
};

export function McpAuthWaitCards({
  requests,
  onSkip,
  onApiKeySubmit,
  onOAuthStart,
}: McpAuthWaitCardsProps): React.JSX.Element | null {
  if (requests.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto mb-3 flex w-full max-w-3xl flex-col gap-3 px-5">
      {requests.map((request) => (
        <McpAuthCard
          key={request.id}
          request={request}
          onSkip={onSkip}
          onApiKeySubmit={onApiKeySubmit}
          onOAuthStart={onOAuthStart}
        />
      ))}
    </div>
  );
}

function McpAuthCard({
  request,
  onSkip,
  onApiKeySubmit,
  onOAuthStart,
}: {
  request: McpAuthWaitRequest;
  onSkip: (id: string) => Promise<void>;
  onApiKeySubmit: (id: string, apiKey: string) => Promise<void>;
  onOAuthStart: (id: string, url: string) => Promise<void>;
}): React.JSX.Element {
  const [apiKey, setApiKey] = useState("");
  const displayName = toDisplayName(request.serviceName);
  const isComplete = request.status === "complete";
  const isAuthenticating = request.status === "authenticating" || request.resolving;

  const handleOAuthClick = () => {
    if (!request.oauthUrl || isAuthenticating || isComplete) return;
    void onOAuthStart(request.id, request.oauthUrl);
  };

  return (
    <div className="rounded-lg bg-card px-4 py-3 shadow-sm ring-1 ring-border/70">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <PlugZap className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-foreground">
                {isComplete ? `${displayName} connected` : `Authenticating ${displayName}...`}
              </div>
              <div className="mt-1 text-base text-muted-foreground">
                {isComplete
                  ? "The MCP server is ready to use."
                  : "Enables the agent to use custom tools and third-party integrations."}
              </div>
            </div>
            {!isComplete && (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isAuthenticating}
                  onClick={() => void onSkip(request.id)}
                >
                  Skip
                </Button>
                {request.authType === "oauth" && (
                  <Button
                    variant="accent"
                    size="sm"
                    disabled={isAuthenticating}
                    onClick={handleOAuthClick}
                  >
                    {isAuthenticating ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Authenticating...
                      </>
                    ) : (
                      <>
                        <PlugZap className="size-4" />
                        Connect
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}
            {isComplete && (
              <div className="flex shrink-0 items-center gap-2 text-base text-green-500">
                <Check className="size-4" />
                Connected
              </div>
            )}
          </div>

          {request.authType === "apikey" && !isComplete && (
            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <Key className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="password"
                  placeholder={request.apiKeyLabel ?? `Enter ${displayName} API key`}
                  value={apiKey}
                  className="flex h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isAuthenticating}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter" && apiKey.trim()) {
                      void onApiKeySubmit(request.id, apiKey.trim());
                    }
                  }}
                />
              </div>
              <Button
                variant="accent"
                size="sm"
                disabled={isAuthenticating || !apiKey.trim()}
                onClick={() => void onApiKeySubmit(request.id, apiKey.trim())}
              >
                {isAuthenticating ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Save
              </Button>
            </div>
          )}

          {request.error && <div className="mt-2 text-base text-destructive">{request.error}</div>}
        </div>
      </div>
    </div>
  );
}

function toDisplayName(serviceName: string): string {
  return serviceName.charAt(0).toUpperCase() + serviceName.slice(1);
}
