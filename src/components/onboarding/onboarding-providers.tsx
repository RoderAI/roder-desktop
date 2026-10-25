import { Check, ChevronDown, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { ProviderConnectCard } from "@/components/providers/provider-connect-card";
import { StepIntro } from "@/components/onboarding/onboarding-primitives";
import { Button } from "@/components/ui/button";
import { type AutoDetectedItem, groupProvidersForOnboarding } from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { useRoderStore } from "@/stores/roder-store";
import type { ClaudeCliStatus, EnvironmentProvider, ProviderDescriptor } from "@/types/roder";

export function OnboardingProvidersStep({
  providers,
  claudeCli,
  environment,
  autoDetected,
  readyProviderIds,
  onRecheckClaudeCli,
  onError,
}: {
  providers: ProviderDescriptor[];
  claudeCli: ClaudeCliStatus | null;
  environment: EnvironmentProvider[];
  autoDetected: AutoDetectedItem[];
  readyProviderIds: ReadonlySet<string>;
  onRecheckClaudeCli: () => Promise<void>;
  onError: (message: string | null) => void;
}): React.JSX.Element {
  const refreshProviders = useRoderStore((state) => state.refreshProviders);
  const { featured, more } = groupProvidersForOnboarding(providers);
  const environmentVars = new Map(environment.map((found) => [found.providerId, found.envVar]));
  // A provider found in the environment opens the "More providers" list by itself, so it is never hidden.
  const detectedInMore = more.some((provider) => environmentVars.has(provider.id));
  const [moreChoice, setMoreChoice] = useState<boolean | null>(null);
  const showMore = moreChoice ?? detectedInMore;

  return (
    <section className="flex flex-col gap-6">
      <StepIntro
        title="Connect a model provider"
        description="Sign in with a subscription you already have, or paste an API key. You can add more providers later in Settings."
      />

      {autoDetected.length > 0 && <AutoDetectedPanel items={autoDetected} />}

      {providers.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl bg-card p-5 ring-1 ring-border/70">
          <p className="text-base text-muted-foreground">
            Roder has not listed any providers yet. It may still be starting up.
          </p>
          <Button variant="ghost" onClick={() => void refreshProviders()}>
            <RefreshCw className="size-4" />
            Try again
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {featured.map((provider) => (
              <ProviderConnectCard
                key={provider.id}
                provider={provider}
                ready={readyProviderIds.has(provider.id)}
                environmentVar={environmentVars.get(provider.id)}
                claudeCli={claudeCli}
                onRecheckClaudeCli={onRecheckClaudeCli}
                onError={onError}
              />
            ))}
          </div>

          {more.length > 0 && (
            <div className="flex flex-col gap-3">
              <Button
                variant="ghost"
                className="self-start"
                aria-expanded={showMore}
                onClick={() => setMoreChoice(!showMore)}
              >
                <ChevronDown className={cn("size-4 transition-transform duration-200", showMore && "rotate-180")} />
                More providers ({more.length})
              </Button>
              {showMore && (
                <div className="grid gap-3 md:grid-cols-2">
                  {more.map((provider) => (
                    <ProviderConnectCard
                      key={provider.id}
                      provider={provider}
                      ready={readyProviderIds.has(provider.id)}
                      environmentVar={environmentVars.get(provider.id)}
                      claudeCli={claudeCli}
                      onRecheckClaudeCli={onRecheckClaudeCli}
                      onError={onError}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AutoDetectedPanel({ items }: { items: AutoDetectedItem[] }): React.JSX.Element {
  return (
    <section
      aria-label="Found on this machine"
      className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-border/70"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">Found on this machine</h2>
        <p className="text-sm text-muted-foreground">
          Roder found these already set up. Nothing is copied into Roder&apos;s settings, and you can skip any of them.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                item.tone === "ready" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
              aria-hidden="true"
            >
              {item.tone === "ready" ? <Check className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
            </span>
            <div className="min-w-0">
              <p className="text-base font-medium">{item.title}</p>
              <p className="text-sm text-muted-foreground">{item.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
