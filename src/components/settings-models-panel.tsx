import { Check, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { visibleModelIdsFor } from "@/lib/roder-models";
import { useRoderStore } from "@/stores/roder-store";
import type { RoderModel } from "@/types/roder";
import { cn } from "@/lib/utils";

export function ModelsSettingsPanel(): React.JSX.Element {
  const models = useRoderStore((state) => state.models);
  const selectedModel = useRoderStore((state) => state.selectedModel);
  const visibleModelIds = useRoderStore((state) => state.visibleModelIds);
  const setModelVisibility = useRoderStore((state) => state.setModelVisibility);
  const resetVisibleModels = useRoderStore((state) => state.resetVisibleModels);
  const [query, setQuery] = useState("");

  const visibleIds = useMemo(() => visibleModelIdsFor(models, visibleModelIds), [models, visibleModelIds]);
  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const filteredModels = useMemo(() => filterModels(models, query), [models, query]);
  const grouped = useMemo(() => groupByProvider(filteredModels), [filteredModels]);
  const customised = visibleModelIds.length > 0;

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <header className="flex items-start justify-between gap-6 border-b border-border px-5 py-4">
        <div>
          <h1 className="text-[16px] font-medium">Models</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {visibleIds.length} of {models.length} shown in the composer
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={!customised} onClick={resetVisibleModels}>
          <RotateCcw className="size-3.5" />
          Show all
        </Button>
      </header>

      <div className="flex h-12 items-center gap-3 border-b border-border px-5">
        <Search className="size-4 text-muted-foreground" />
        <input
          value={query}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Search models"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      {models.length === 0 ? (
        <div className="px-5 py-8 text-[14px] text-muted-foreground">No models loaded from the app-server.</div>
      ) : filteredModels.length === 0 ? (
        <div className="px-5 py-8 text-[14px] text-muted-foreground">No matching models.</div>
      ) : (
        <div className="divide-y divide-border">
          {grouped.map((group) => (
            <section key={group.provider} className="px-5 py-4">
              <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">{providerName(group.provider)}</h2>
              <div className="space-y-1">
                {group.models.map((model) => {
                  const visible = visibleSet.has(model.id);
                  return (
                    <ModelVisibilityRow
                      key={model.id}
                      model={model}
                      selected={model.id === selectedModel}
                      visible={visible}
                      disabled={visible && visibleIds.length <= 1}
                      onToggle={() => setModelVisibility(model.id, !visible)}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function ModelVisibilityRow({
  model,
  selected,
  visible,
  disabled,
  onToggle,
}: {
  model: RoderModel;
  selected: boolean;
  visible: boolean;
  disabled: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
        visible ? "text-foreground hover:bg-accent/70" : "text-muted-foreground hover:bg-accent/40",
      )}
      disabled={disabled}
      onClick={onToggle}
    >
      <VisibilitySwitch checked={visible} disabled={disabled} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px]">{model.name || model.id}</span>
          {selected && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Selected</span>
          )}
        </div>
        {model.description && <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{model.description}</div>}
      </div>
      {visible && <Check className="size-4 shrink-0 text-primary" />}
    </button>
  );
}

function VisibilitySwitch({ checked, disabled }: { checked: boolean; disabled: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
        disabled && "opacity-50",
      )}
    >
      <span className={cn("absolute left-1 top-1 size-4 rounded-full bg-white transition-transform", checked && "translate-x-4")} />
    </span>
  );
}

function filterModels(models: RoderModel[], query: string): RoderModel[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return models;
  }
  return models.filter((model) => `${model.name} ${model.id} ${model.modelProvider}`.toLowerCase().includes(needle));
}

function groupByProvider(models: RoderModel[]): Array<{ provider: string; models: RoderModel[] }> {
  const groups = new Map<string, RoderModel[]>();
  for (const model of models) {
    const provider = model.modelProvider || "roder";
    groups.set(provider, [...(groups.get(provider) ?? []), model]);
  }
  return [...groups.entries()].map(([provider, groupModels]) => ({ provider, models: groupModels }));
}

function providerName(provider: string): string {
  if (provider.toLowerCase() === "openai") {
    return "OpenAI";
  }
  return provider.slice(0, 1).toUpperCase() + provider.slice(1);
}
