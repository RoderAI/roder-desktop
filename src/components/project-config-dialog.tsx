import { FolderPlus, Star, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModelPicker } from "@/components/composer-controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { roderIpc } from "@/lib/roder-ipc";
import type { ProjectPersistentAgentConfig } from "@/lib/project-persistent-agent";
import { modelKey, resolveReasoningEffort } from "@/lib/roder-models";
import { useRoderStore } from "@/stores/roder-store";
import { cn } from "@/lib/utils";

type ProjectConfigDialogProps = {
  open: boolean;
  defaultPath?: string;
  initialFolders?: string[];
  creating?: boolean;
  error?: string | null;
  projectCreated?: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateProject: (params: ProjectPersistentAgentConfig) => Promise<void>;
};

export function ProjectConfigDialog(props: ProjectConfigDialogProps): React.JSX.Element | null {
  return props.open ? <ProjectConfigForm {...props} /> : null;
}

function ProjectConfigForm({
  open,
  defaultPath,
  initialFolders = [],
  creating = false,
  error,
  projectCreated = false,
  onOpenChange,
  onCreateProject,
}: ProjectConfigDialogProps): React.JSX.Element {
  const [name, setName] = useState("");
  const [folders, setFolders] = useState<string[]>(() => uniquePaths(initialFolders));
  const [defaultRootPath, setDefaultRootPath] = useState(() => uniquePaths(initialFolders)[0] ?? "");
  const [mission, setMission] = useState("");
  const models = useRoderStore((state) => state.models);
  const [selectedModelKey, setSelectedModelKey] = useState(() => {
    const state = useRoderStore.getState();
    const model =
      state.models.find(
        (candidate) => candidate.id === state.selectedModel && candidate.modelProvider === state.selectedModelProvider,
      ) ?? state.models[0];
    return model ? modelKey(model) : "";
  });
  const [requestedReasoning, setRequestedReasoning] = useState(() => useRoderStore.getState().selectedReasoning);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const projectNameInputId = useId();

  const selectedModel =
    models.find((model) => modelKey(model) === selectedModelKey) ?? (!selectedModelKey ? models[0] : undefined);
  const reasoning = resolveReasoningEffort(selectedModel, requestedReasoning);

  async function addFolders(): Promise<void> {
    setPickerError(null);
    try {
      const selected = await roderIpc.openWorkspaceFolders(defaultPath);
      if (!selected || selected.length === 0) {
        return;
      }
      const next = uniquePaths([...folders, ...selected]);
      setFolders(next);
      if (!defaultRootPath && next[0]) setDefaultRootPath(next[0]);
    } catch (error) {
      setPickerError((error as Error).message);
    }
  }

  function removeFolder(path: string): void {
    const next = folders.filter((folder) => folder !== path);
    setFolders(next);
    if (defaultRootPath === path) setDefaultRootPath(next[0] ?? "");
  }

  function createProject(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const roots = folders.map((path) => ({ path }));
    const firstRoot = roots[0]?.path;
    if (!firstRoot) {
      setPickerError("Add at least one workspace folder before creating a project.");
      return;
    }
    if (!selectedModel || !mission.trim()) return;
    void onCreateProject({
      workspace: { name: name.trim() || undefined, roots, defaultRootPath: defaultRootPath || firstRoot },
      mission: mission.trim(),
      model: selectedModel.id,
      modelProvider: selectedModel.modelProvider,
      reasoning: reasoning ?? undefined,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!creating) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-2xl" showCloseButton={!creating}>
        <DialogHeader>
          <DialogTitle>Add project persistent agent</DialogTitle>
          <DialogDescription>
            Give this project a persistent agent thread and a mission. It keeps the same conversation and durable
            memory, and starts paused until you enable it in Persistent Agents.
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={createProject}>
          <fieldset disabled={creating || projectCreated} className="flex min-w-0 flex-col gap-4 disabled:opacity-60">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground" htmlFor={projectNameInputId}>
              Project name <span className="font-normal text-muted-foreground">optional</span>
              <InputGroup>
                <InputGroupInput
                  id={projectNameInputId}
                  value={name}
                  placeholder="Derived from the default folder when blank"
                  onChange={(event) => setName(event.target.value)}
                />
              </InputGroup>
            </label>

            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">Workspace folders</h3>
                  <p className="text-sm text-muted-foreground">Attach every folder this project should include.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void addFolders()}>
                  <FolderPlus className="size-4" />
                  Add folders
                </Button>
              </div>

              <div
                className={cn(
                  "min-h-40 rounded-xl border border-border bg-card/60 p-2",
                  folders.length === 0 && "flex items-center justify-center",
                )}
              >
                {folders.length === 0 ? (
                  <button
                    type="button"
                    className="flex flex-col items-center gap-2 rounded-lg px-6 py-5 text-center text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => void addFolders()}
                  >
                    <FolderPlus className="size-5" />
                    Choose one or more folders
                  </button>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {folders.map((folder) => {
                      const isDefault = folder === defaultRootPath;
                      return (
                        <li
                          key={folder}
                          className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm hover:bg-accent/60"
                        >
                          <button
                            type="button"
                            className={cn(
                              "flex size-7 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                              isDefault ? "text-amber-500" : "text-muted-foreground",
                            )}
                            aria-label={`Make ${folder} the default folder`}
                            title={isDefault ? "Default folder" : "Make default"}
                            onClick={() => setDefaultRootPath(folder)}
                          >
                            <Star className={cn("size-4", isDefault && "fill-current")} />
                          </button>
                          <span className="min-w-0 flex-1 truncate" title={folder}>
                            {folder}
                          </span>
                          {isDefault && <span className="text-xs text-muted-foreground">Default</span>}
                          <InputGroupButton
                            type="button"
                            aria-label={`Remove ${folder}`}
                            title="Remove folder"
                            onClick={() => removeFolder(folder)}
                          >
                            <Trash2 className="size-3.5" />
                          </InputGroupButton>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {pickerError && <p className="text-sm text-destructive">{pickerError}</p>}
            </section>
          </fieldset>

          <label htmlFor={`${projectNameInputId}-mission`} className="flex flex-col gap-1.5 text-base font-medium">
            Mission
            <textarea
              id={`${projectNameInputId}-mission`}
              value={mission}
              onChange={(event) => setMission(event.target.value)}
              required
              disabled={creating}
              rows={3}
              placeholder="What should this persistent agent keep moving forward?"
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-base font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <fieldset disabled={creating || models.length === 0} className="min-w-0 space-y-1.5 disabled:opacity-60">
            <legend className="text-base font-medium">Model and reasoning</legend>
            {selectedModel ? (
              <ModelPicker
                models={models}
                routingOptions={[]}
                selectedModel={selectedModel.id}
                selectedModelProvider={selectedModel.modelProvider}
                selectedSelectionMode={{
                  type: "manual",
                  provider: selectedModel.modelProvider,
                  model: selectedModel.id,
                }}
                selectedReasoning={reasoning ?? ""}
                onChange={(id, provider) => {
                  const model = models.find((candidate) => candidate.id === id && candidate.modelProvider === provider);
                  if (model) setSelectedModelKey(modelKey(model));
                  setRequestedReasoning("");
                }}
                onAutoChange={() => {}}
                onReasoningChange={setRequestedReasoning}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No model available</p>
            )}
          </fieldset>
          {projectCreated ? (
            <p className="text-sm font-normal text-muted-foreground">
              Your project and thread are already created. Retry to finish persistent agent setup without creating
              another conversation.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={creating} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="accent"
              disabled={creating || folders.length === 0 || !mission.trim() || !selectedModel}
            >
              {creating
                ? "Creating…"
                : projectCreated
                  ? "Retry persistent agent setup"
                  : "Create project persistent agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    const normalized = path.trim().replace(/\/+$/, "") || path.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}
