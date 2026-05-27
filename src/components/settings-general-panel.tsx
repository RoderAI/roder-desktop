import { Check, Save } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { visibleModelsFor } from "@/lib/roder-models";
import { useRoderStore } from "@/stores/roder-store";
import type { PolicyMode, ReasoningEffort, RoderModel } from "@/types/roder";

const reasoningOptions: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];

const policyOptions: Array<{ mode: PolicyMode; label: string; description: string }> = [
  {
    mode: "accept_all",
    label: "Accept all",
    description: "Run edits and commands without stopping for approval.",
  },
  {
    mode: "default",
    label: "Ask before changes",
    description: "Pause before writes, commands, and other side effects.",
  },
  {
    mode: "plan",
    label: "Plan only",
    description: "Read and reason while blocking edits and commands.",
  },
  {
    mode: "bypass",
    label: "Full access",
    description: "Auto-approve every tool the harness allows.",
  },
];

export function GeneralSettingsPanel(): React.JSX.Element {
  const allModels = useRoderStore((state) => state.models);
  const visibleModelIds = useRoderStore((state) => state.visibleModelIds);
  const defaultModel = useRoderStore((state) => state.defaultModel);
  const defaultReasoning = useRoderStore((state) => state.defaultReasoning);
  const defaultPolicyMode = useRoderStore((state) => state.defaultPolicyMode);
  const setDefaultModel = useRoderStore((state) => state.setDefaultModel);
  const setDefaultReasoning = useRoderStore((state) => state.setDefaultReasoning);
  const setDefaultPolicyMode = useRoderStore((state) => state.setDefaultPolicyMode);
  const saveDefaults = useRoderStore((state) => state.saveDefaults);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const models = useMemo(() => visibleModelsFor(allModels, visibleModelIds), [allModels, visibleModelIds]);
  const selectedModelRecord = useMemo(
    () => models.find((model) => model.id === defaultModel) ?? models[0],
    [models, defaultModel],
  );
  const modelItems = useMemo(
    () => Object.fromEntries(models.map((model) => [model.id, modelName(model)])),
    [models],
  );
  const canSave = Boolean(selectedModelRecord) && !saving;

  async function saveDefaultControls(): Promise<void> {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveDefaults();
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      <header className="flex items-start justify-between gap-6 border-b border-border px-5 py-4">
        <div>
          <h1 className="text-base font-medium">General</h1>
          <p className="mt-1 text-base text-muted-foreground">Defaults for new work</p>
        </div>
        <Button variant="accent" size="sm" disabled={!canSave} onClick={() => void saveDefaultControls()}>
          {saved ? <Check className="size-3.5" /> : <Save className="size-3.5" />}
          {saving ? "Saving" : saved ? "Saved" : "Save defaults"}
        </Button>
      </header>

      <div className="divide-y divide-border px-5">
        <SettingsRow label="Model" description={selectedModelDescription(selectedModelRecord)}>
          <Select
            items={modelItems}
            value={selectedModelRecord?.id ?? ""}
            disabled={models.length === 0}
            onValueChange={(value) => setDefaultModel(value ?? "")}
          >
            <SelectTrigger className="w-[300px] border border-border bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="w-[340px]">
              <SelectGroup>
                {models.map((model) => (
                  <SelectItem key={`${model.modelProvider}:${model.id}`} value={model.id}>
                    {modelName(model)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow label="Reasoning" description="Thinking effort used when starting new turns">
          <Select
            items={Object.fromEntries(reasoningOptions.map((reasoning) => [reasoning, reasoningLabel(reasoning)]))}
            value={defaultReasoning}
            onValueChange={(value) => setDefaultReasoning((value ?? "medium") as ReasoningEffort)}
          >
            <SelectTrigger className="w-[220px] border border-border bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {reasoningOptions.map((reasoning) => (
                  <SelectItem key={reasoning} value={reasoning}>
                    {reasoningLabel(reasoning)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow label="Policy mode" description={policyOptions.find((option) => option.mode === defaultPolicyMode)?.description ?? ""}>
          <Select
            items={Object.fromEntries(policyOptions.map((option) => [option.mode, option.label]))}
            value={defaultPolicyMode}
            onValueChange={(value) => setDefaultPolicyMode((value ?? "default") as PolicyMode)}
          >
            <SelectTrigger className="w-[220px] border border-border bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {policyOptions.map((option) => (
                  <SelectItem key={option.mode} value={option.mode}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingsRow>
      </div>

      {error && <div className="border-t border-border px-5 py-3 text-base text-destructive">{error}</div>}
    </section>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 py-4">
      <div className="min-w-0">
        <div className="text-base font-medium">{label}</div>
        <div className="mt-1 max-w-[440px] text-base text-muted-foreground">{description}</div>
      </div>
      {children}
    </div>
  );
}

function modelName(model: RoderModel): string {
  return model.name || model.id;
}

function selectedModelDescription(model: RoderModel | undefined): string {
  if (!model) {
    return "Models will appear after the app-server finishes loading.";
  }
  return `${providerName(model.modelProvider)} / ${model.id}`;
}

function providerName(provider: string): string {
  if (provider.toLowerCase() === "openai") {
    return "OpenAI";
  }
  return provider.slice(0, 1).toUpperCase() + provider.slice(1);
}

function reasoningLabel(reasoning: ReasoningEffort): string {
  if (reasoning === "xhigh") {
    return "Extra high";
  }
  return reasoning.slice(0, 1).toUpperCase() + reasoning.slice(1);
}
