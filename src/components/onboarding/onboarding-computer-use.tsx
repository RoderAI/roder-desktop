import { MousePointer2 } from "lucide-react";
import { MacComputerUsePermissionCard } from "@/components/macos-computer-use-permissions";

export function OnboardingComputerUseStep({
  onReadyChange,
}: {
  onReadyChange: (ready: boolean) => void;
}): React.JSX.Element {
  return (
    <section className="mx-auto flex w-full max-w-lg flex-col gap-6 pt-4 text-center">
      <div className="relative mx-auto h-28 w-56" aria-hidden="true">
        <div className="absolute left-1 top-3 h-20 w-28 -rotate-9 rounded-lg bg-muted ring-1 ring-border" />
        <div className="absolute right-1 top-3 h-20 w-28 rotate-9 rounded-lg bg-muted ring-1 ring-border" />
        <div className="absolute inset-x-10 top-5 h-20 rounded-lg bg-card text-muted-foreground shadow-sm ring-1 ring-primary/60">
          <div className="flex gap-1 border-b border-border p-2">
            <span className="size-1.5 rounded-full bg-primary/60" />
            <span className="size-1.5 rounded-full bg-muted-foreground/20" />
            <span className="size-1.5 rounded-full bg-muted-foreground/20" />
          </div>
          <div className="grid gap-2 p-3">
            <span className="h-1.5 w-14 rounded-full bg-muted" />
            <span className="h-1.5 w-20 rounded-full bg-muted" />
            <span className="h-1.5 w-12 rounded-full bg-muted" />
          </div>
          <MousePointer2 className="absolute bottom-3 right-5 size-6 fill-foreground stroke-background" />
        </div>
      </div>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Set up computer use</h1>
        <p className="text-base text-muted-foreground">
          Allow the CuaDriver helper to see your screen and interact with apps. You can skip this step and return to
          Settings → Computer use later.
        </p>
      </header>
      <MacComputerUsePermissionCard onReadyChange={onReadyChange} />
    </section>
  );
}
