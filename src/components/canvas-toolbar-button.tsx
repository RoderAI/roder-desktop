import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CanvasToolbarButtonProps = {
  active?: boolean;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void | Promise<void>;
};

export function CanvasToolbarButton({
  active,
  children,
  className,
  disabled,
  label,
  onClick,
}: CanvasToolbarButtonProps): React.JSX.Element {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="icon"
      className={cn("size-8 shrink-0 rounded-md text-muted-foreground", active && "text-foreground", className)}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => void onClick()}
    >
      {children}
    </Button>
  );
}
