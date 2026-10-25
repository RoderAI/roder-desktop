import { Check } from "lucide-react";
import { projectFolderPath } from "@/components/onboarding/onboarding-project";
import { providerCopy } from "@/lib/provider-copy";
import { providerName } from "@/lib/roder-models";
import { cn } from "@/lib/utils";
import type { ProviderDescriptor, Workspace } from "@/types/roder";

export function OnboardingReadyStep({
  providers,
  readyProviderIds,
  modelLabel,
  modelProviderId,
  project,
}: {
  providers: ProviderDescriptor[];
  readyProviderIds: ReadonlySet<string>;
  modelLabel: string | null;
  modelProviderId: string | null;
  project: Workspace | null;
}): React.JSX.Element {
  const readyNames = providers
    .filter((provider) => readyProviderIds.has(provider.id))
    .map((provider) => providerCopy[provider.id]?.title ?? (provider.name || providerName(provider.id)));
  const modelDetail = modelProviderId ? (providerCopy[modelProviderId]?.title ?? providerName(modelProviderId)) : null;
  const folder = project ? projectFolderPath(project) : null;

  return (
    <section className="flex flex-col items-center gap-8 pt-4 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
        <Check className="size-7" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">You are all set</h1>
        <p className="mx-auto max-w-[52ch] text-base text-muted-foreground">
          Roder is connected. Start an agent in your project and it will use the model you chose.
        </p>
      </div>

      <div className="grid w-full gap-3 text-left md:grid-cols-3">
        <SummaryTile label="Providers" value={readyNames.join(", ") || "None yet"} />
        <SummaryTile label="Default model" value={modelLabel ?? "Not set"} detail={modelDetail ?? undefined} />
        <SummaryTile
          label="Project"
          value={project?.name ?? "Not added yet"}
          detail={folder ?? "You can add one from the sidebar at any time."}
          detailIsPath={folder !== null}
        />
      </div>
    </section>
  );
}

function SummaryTile({
  label,
  value,
  detail,
  detailIsPath = false,
}: {
  label: string;
  value: string;
  detail?: string;
  detailIsPath?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-border/70">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="break-words text-base font-medium">{value}</span>
      {detail && (
        <span className={cn("break-all text-sm text-muted-foreground", detailIsPath && "font-mono")}>{detail}</span>
      )}
    </div>
  );
}
