import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

const avatarPalette = [
  { bg: "oklch(0.92 0.06 20)", fg: "oklch(0.45 0.14 20)" },
  { bg: "oklch(0.93 0.07 95)", fg: "oklch(0.48 0.12 95)" },
  { bg: "oklch(0.92 0.05 250)", fg: "oklch(0.42 0.12 250)" },
  { bg: "oklch(0.93 0.06 150)", fg: "oklch(0.42 0.11 150)" },
  { bg: "oklch(0.92 0.06 310)", fg: "oklch(0.45 0.12 310)" },
  { bg: "oklch(0.93 0.05 60)", fg: "oklch(0.48 0.1 60)" },
] as const;

export function SubagentAvatar({ seed, className }: { seed: string; className?: string }): React.JSX.Element {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  const color = avatarPalette[Math.abs(hash) % avatarPalette.length];
  return (
    <span
      className={cn("grid size-7 shrink-0 place-items-center rounded-full", className)}
      style={{ backgroundColor: color.bg, color: color.fg }}
      aria-hidden="true"
    >
      <Bot className="size-3.5" />
    </span>
  );
}
