import { Compass, LoaderCircle, Pause } from "lucide-react";
import { useId, useRef, useState } from "react";
import { ModelPicker } from "@/components/composer-controls";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { persistentAgentCreateParams } from "@/lib/persistent-agent-create";
import { modelKey, resolveReasoningEffort } from "@/lib/roder-models";
import { modelProviderReady } from "@/lib/model-picker";
import { useRoderStore } from "@/stores/roder-store";
import type { PersistentAgentCreate } from "@/types/persistent-agents";
import type { RoderModel, Workspace } from "@/types/roder";

export function PersistentAgentCreateDialog({
  open,
  onOpenChange,
  workspaces,
  models,
  error,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  models: RoderModel[];
  error: string | null;
  onCreate: (params: PersistentAgentCreate) => Promise<boolean>;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>();
  const [modelChoice, setModelChoice] = useState(() => {
    const state = useRoderStore.getState();
    return state.selectedModel ? modelKey({ id: state.selectedModel, modelProvider: state.selectedModelProvider }) : "";
  });
  const [requestedReasoning, setRequestedReasoning] = useState(() => useRoderStore.getState().selectedReasoning);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const providers = useRoderStore((state) => state.providers);
  const activeWorkspaceId = useRoderStore((state) => state.selectedWorkspaceId);
  const nameId = useId();
  const missionId = useId();
  const projectId = useId();
  const projectPathId = useId();
  const chosenWorkspace =
    workspaceId === undefined
      ? (workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
        (workspaces.length === 1 ? workspaces[0] : null))
      : (workspaces.find((workspace) => workspace.id === workspaceId) ?? null);
  const chosenModel =
    models.find((model) => modelKey(model) === modelChoice) ??
    models.find((model) => model.isDefault && modelProviderReady(model, providers)) ??
    models.find((model) => modelProviderReady(model, providers));
  const reasoning = resolveReasoningEffort(chosenModel, requestedReasoning);
  const params = persistentAgentCreateParams(
    {
      name,
      mission,
      workspaceId: chosenWorkspace?.id ?? "",
      model: chosenModel,
      reasoning: reasoning ?? undefined,
    },
    providers,
  );
  const projectPath =
    chosenWorkspace?.roots.find((root) => root.id === chosenWorkspace.defaultRootId)?.path ??
    chosenWorkspace?.roots[0]?.path;

  function changeOpen(next: boolean): void {
    if (pending.current) return;
    onOpenChange(next);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!params || pending.current) return;
    pending.current = true;
    setSubmitting(true);
    const created = await onCreate(params).finally(() => {
      pending.current = false;
      setSubmitting(false);
    });
    if (created) {
      setName("");
      setMission("");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={<Button />}>New persistent agent</DialogTrigger>
      <DialogContent className="max-w-lg gap-0 rounded-2xl p-0" showCloseButton={!submitting}>
        <div className="flex items-start gap-3 px-5 pb-4 pt-5">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/40 text-muted-foreground">
            <Compass className="size-4" />
          </div>
          <DialogHeader className="min-w-0 gap-1">
            <DialogTitle className="font-semibold">New persistent agent</DialogTitle>
            <DialogDescription className="text-sm font-normal leading-5">
              Give your project an agent that keeps its context.
            </DialogDescription>
          </DialogHeader>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={submitting} className="min-w-0 space-y-3 px-5 pb-5 disabled:opacity-60">
            <div className="space-y-1.5">
              <label htmlFor={nameId} className="block text-base font-medium">
                Name
              </label>
              <InputGroup>
                <InputGroupInput
                  id={nameId}
                  name="name"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Release coordinator"
                  className="h-8 text-base"
                />
              </InputGroup>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={missionId} className="block text-base font-medium">
                Mission
              </label>
              <Textarea
                id={missionId}
                name="mission"
                required
                maxLength={16000}
                rows={3}
                value={mission}
                onChange={(event) => setMission(event.target.value)}
                placeholder="What should this agent own? For example, triage issues, coordinate fixes, and verify changes."
                className="min-h-20 rounded-lg font-normal leading-5"
              />
            </div>
            <div className="space-y-1.5">
              <span id={projectId} className="block text-base font-medium">
                Project
              </span>
              <Combobox<Workspace>
                items={workspaces}
                value={chosenWorkspace}
                onValueChange={(workspace) => setWorkspaceId(workspace?.id ?? null)}
                itemToStringLabel={(workspace) => workspace.name}
                itemToStringValue={(workspace) => workspace.id}
                isItemEqualToValue={(item, value) => item.id === value.id}
                filter={(workspace, query) =>
                  `${workspace.name} ${workspace.roots.map((root) => root.path).join(" ")}`
                    .toLowerCase()
                    .includes(query.trim().toLowerCase())
                }
              >
                <ComboboxInput
                  aria-labelledby={projectId}
                  aria-describedby={projectPath ? projectPathId : undefined}
                  placeholder="Search projects…"
                  className="h-8 w-full"
                />
                <ComboboxContent className="rounded-xl">
                  <ComboboxEmpty>No matching projects</ComboboxEmpty>
                  <ComboboxList>
                    {(workspace: Workspace) => (
                      <ComboboxItem key={workspace.id} value={workspace} className="rounded-lg px-3 py-2 text-base">
                        <span className="min-w-0">
                          <span className="block truncate">{workspace.name}</span>
                          <span className="block truncate text-sm font-normal text-muted-foreground">
                            {workspace.roots.find((root) => root.id === workspace.defaultRootId)?.path ??
                              workspace.roots[0]?.path}
                          </span>
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {projectPath ? (
                <p
                  id={projectPathId}
                  className="truncate text-sm font-normal text-muted-foreground"
                  title={projectPath}
                >
                  {projectPath}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/30 px-3 py-2">
              <span className="text-sm text-muted-foreground">Model &amp; reasoning</span>
              <ModelPicker
                models={models}
                routingOptions={[]}
                selectedModel={chosenModel?.id ?? ""}
                selectedModelProvider={chosenModel?.modelProvider ?? ""}
                selectedSelectionMode={{
                  type: "manual",
                  provider: chosenModel?.modelProvider ?? "",
                  model: chosenModel?.id ?? "",
                }}
                selectedReasoning={reasoning ?? ""}
                onChange={(id, provider) => {
                  const model = models.find((candidate) => candidate.id === id && candidate.modelProvider === provider);
                  if (model) setModelChoice(modelKey(model));
                  setRequestedReasoning("");
                }}
                onAutoChange={() => {}}
                onReasoningChange={setRequestedReasoning}
              />
            </div>
            {error ? (
              <p role="alert" className="rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-muted/20 px-5 py-3">
            <div className="space-y-1 text-sm text-muted-foreground">
              <p className="inline-flex items-center gap-1.5">
                <Pause className="size-3.5" /> Starts paused
              </p>
              <p className="font-normal">Character creation uses Codex quota.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-lg"
                disabled={submitting}
                onClick={() => changeOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="accent" size="sm" className="rounded-lg" disabled={!params || submitting}>
                {submitting ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {submitting ? "Creating…" : "Create agent"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
