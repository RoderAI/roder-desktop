import { FolderPlus, Star, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { roderIpc, type WorkspaceCreateParams } from "@/lib/roder-ipc";
import { cn } from "@/lib/utils";

type ProjectConfigDialogProps = {
  open: boolean;
  defaultPath?: string;
  initialFolders?: string[];
  creating?: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateProject: (params: WorkspaceCreateParams) => void;
};

export function ProjectConfigDialog({
  open,
  defaultPath,
  initialFolders = [],
  creating = false,
  onOpenChange,
  onCreateProject,
}: ProjectConfigDialogProps): React.JSX.Element {
  const [name, setName] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [defaultRootPath, setDefaultRootPath] = useState("");
  const [pickerError, setPickerError] = useState<string | null>(null);
  const projectNameInputId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const seededFolders = uniquePaths(initialFolders);
    setName("");
    setFolders(seededFolders);
    setDefaultRootPath(seededFolders[0] ?? "");
    setPickerError(null);
  }, [initialFolders, open]);

  async function addFolders(): Promise<void> {
    setPickerError(null);
    try {
      const selected = await roderIpc.openWorkspaceFolders(defaultPath);
      if (!selected || selected.length === 0) {
        return;
      }
      setFolders((current) => {
        const next = uniquePaths([...current, ...selected]);
        if (!defaultRootPath && next[0]) {
          setDefaultRootPath(next[0]);
        }
        return next;
      });
    } catch (error) {
      setPickerError((error as Error).message);
    }
  }

  function removeFolder(path: string): void {
    setFolders((current) => {
      const next = current.filter((folder) => folder !== path);
      if (defaultRootPath === path) {
        setDefaultRootPath(next[0] ?? "");
      }
      return next;
    });
  }

  function createProject(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const roots = folders.map((path) => ({ path }));
    const firstRoot = roots[0]?.path;
    if (!firstRoot) {
      setPickerError("Add at least one workspace folder before creating a project.");
      return;
    }
    onCreateProject({
      name: name.trim() || undefined,
      roots,
      defaultRootPath: defaultRootPath || firstRoot,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add project</DialogTitle>
          <DialogDescription>
            Configure one Roder project with one or more workspace folders. New agents start in the default folder, and
            all attached folders remain available to the project.
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={createProject}>
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

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="accent" disabled={creating || folders.length === 0}>
              {creating ? "Creating..." : "Create project"}
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
