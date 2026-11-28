import { FileText, Folder, HardDrive } from "lucide-react";
import { FullDiskAccessCard } from "@/components/full-disk-access-card";

export function OnboardingFullDiskAccessStep({
  onSettingsOpened,
}: {
  onSettingsOpened: () => void;
}): React.JSX.Element {
  return (
    <section className="mx-auto flex w-full max-w-lg flex-col gap-6 pt-4 text-center">
      <div className="relative mx-auto h-28 w-56" aria-hidden="true">
        <div className="absolute left-6 top-6 grid size-16 -rotate-9 place-items-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border">
          <Folder className="size-7" />
        </div>
        <div className="absolute right-6 top-6 grid size-16 rotate-9 place-items-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border">
          <FileText className="size-7" />
        </div>
        <div className="absolute inset-x-20 top-4 grid size-16 place-items-center rounded-xl bg-card text-primary shadow-sm ring-1 ring-primary/60">
          <HardDrive className="size-8" />
        </div>
      </div>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Allow access to protected files?</h1>
        <p className="text-base text-muted-foreground">
          Roder doesn&apos;t need Full Disk Access for normal project work. Skip this step unless a task needs files
          that macOS normally protects.
        </p>
      </header>
      <FullDiskAccessCard onSettingsOpened={onSettingsOpened} />
    </section>
  );
}
