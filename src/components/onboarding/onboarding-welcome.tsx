import { FolderOpen, Plug, Sparkles } from "lucide-react";
import roderAppIcon from "@/assets/roder-app-icon.png";

const highlights = [
  {
    icon: Plug,
    title: "Connect a provider",
    body: "Sign in with a subscription you already have, or paste an API key.",
  },
  {
    icon: Sparkles,
    title: "Pick a default model",
    body: "Choose the model new agents use, and which ones show in the picker.",
  },
  {
    icon: FolderOpen,
    title: "Add a project",
    body: "Point Roder at a folder. Agents read and change files only there.",
  },
];

export function OnboardingWelcomeStep(): React.JSX.Element {
  return (
    <section className="flex flex-col items-center gap-10 pt-6 text-center">
      <div className="relative flex items-center justify-center">
        <span aria-hidden="true" className="absolute size-44 rounded-full bg-primary/5 blur-3xl" />
        <img src={roderAppIcon} alt="" className="relative size-24 drop-shadow-sm" draggable={false} />
      </div>

      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Roder</h1>
        <p className="mx-auto max-w-[52ch] text-base text-muted-foreground">
          Roder runs coding agents inside your projects. Connect a model, choose a default, and add a folder. It takes
          about two minutes.
        </p>
      </div>

      <ul className="grid w-full gap-3 text-left md:grid-cols-3">
        {highlights.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-border/70">
            <span className="grid size-9 place-items-center rounded-lg bg-muted/50">
              <Icon className="size-4" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-base font-medium">{title}</p>
              <p className="text-sm text-muted-foreground">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
