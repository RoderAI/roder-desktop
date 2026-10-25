import { FolderOpen } from "lucide-react";
import { primaryActionClassName, StepIntro } from "@/components/onboarding/onboarding-primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/types/roder";

export function projectFolderPath(project: Workspace): string | null {
  return project.roots.find((root) => root.id === project.defaultRootId)?.path ?? project.roots[0]?.path ?? null;
}

export function OnboardingProjectStep({
  project,
  busy,
  onChooseFolder,
}: {
  project: Workspace | null;
  busy: boolean;
  onChooseFolder: () => void;
}): React.JSX.Element {
  const folder = project ? projectFolderPath(project) : null;

  return (
    <section className="flex flex-col gap-6">
      <StepIntro
        title="Add your first project"
        description="Pick the folder agents should work in. Roder reads and edits files only inside the folders you add."
      />

      {project ? (
        <div className="flex items-center gap-4 rounded-xl bg-card p-5 ring-1 ring-border/70">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted/50">
            <FolderOpen className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-medium">{project.name}</p>
            {folder && <p className="mt-0.5 truncate font-mono text-sm text-muted-foreground">{folder}</p>}
          </div>
          <Button variant="ghost" disabled={busy} onClick={onChooseFolder}>
            Change folder
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            "flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-card/60 px-6 py-12 text-center",
          )}
        >
          <span className="grid size-12 place-items-center rounded-xl bg-muted/50">
            <FolderOpen className="size-6" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-base font-medium">Choose a project folder</p>
            <p className="text-base text-muted-foreground">A git repository works best, but any folder is fine.</p>
          </div>
          <Button className={primaryActionClassName} disabled={busy} onClick={onChooseFolder}>
            {busy ? "Opening..." : "Choose folder"}
          </Button>
        </div>
      )}
    </section>
  );
}
