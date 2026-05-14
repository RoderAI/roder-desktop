import { ChevronDown, ExternalLink, Gauge, Loader2, LogIn, LogOut, Settings, SlidersHorizontal, UserCircle } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CodexAccountSnapshot, CodexRateWindow } from "@/types/gode";
import { useThemeStore } from "@/stores/theme-store";

export function SidebarAccountMenu(): React.JSX.Element {
  const [account, setAccount] = useState<CodexAccountSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(true);
  const [busy, setBusy] = useState<"login" | "logout" | null>(null);
  const openSettings = useThemeStore((state) => state.openSettings);

  useEffect(() => {
    let cancelled = false;
    void window.godeDesktop.codexAccount().then((snapshot) => {
      if (!cancelled) {
        setAccount(snapshot);
        setLimitsOpen(Boolean(snapshot.limits));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh(): Promise<void> {
    setAccount(await window.godeDesktop.codexAccount());
  }

  async function login(): Promise<void> {
    setBusy("login");
    try {
      setAccount(await window.godeDesktop.codexLogin());
    } finally {
      setBusy(null);
    }
  }

  async function logout(): Promise<void> {
    setBusy("logout");
    try {
      setAccount(await window.godeDesktop.codexLogout());
    } finally {
      setBusy(null);
    }
  }

  const signedIn = account?.signedIn ?? false;
  const label = account?.displayName ?? (signedIn ? "Codex account" : "Sign in to Codex");
  const secondary = account?.godeSignedIn ? "Gode connected" : account?.codexSignedIn ? "Codex detected" : "Connect provider";

  return (
    <div className="no-drag shrink-0 border-t border-border/70 p-3">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-12 w-full justify-start gap-3 rounded-lg px-2.5 text-[15px] text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={() => void refresh()}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-active text-[13px] text-sidebar-active-foreground">
              {account?.displayName ? initials(account.displayName) : "G"}
            </div>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sidebar-active-foreground">{label}</span>
              <span className="block truncate text-[12px] text-sidebar-muted">{secondary}</span>
            </span>
            <SlidersHorizontal className="size-4 shrink-0 text-sidebar-muted" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={10}
          className="w-[306px] rounded-2xl border-border/80 bg-popover p-1.5 text-[14px] shadow-2xl"
        >
          <DropdownMenuGroup className="space-y-1">
            <MenuRow muted icon={<UserCircle className="size-4" />} label={label} />
            <MenuRow muted icon={<Settings className="size-4" />} label="Personal account" detail={account?.planType ?? undefined} />
            <DropdownMenuItem className="h-10 rounded-xl px-3 text-[15px] focus:bg-accent" onSelect={() => openSettings("appearance")}>
              <Settings className="size-4" />
              Settings
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <div className="my-2 h-px bg-border/70" />

          <button
            type="button"
            className="flex h-10 w-full items-center gap-3 rounded-xl bg-accent/70 px-3 text-left text-[15px] text-foreground outline-none hover:bg-accent"
            onClick={() => setLimitsOpen((value) => !value)}
          >
            <Gauge className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Rate limits remaining</span>
            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", limitsOpen && "rotate-180")} />
          </button>

          {limitsOpen && (
            <div className="space-y-2 px-5 py-3">
              <LimitLine window={account?.limits?.primary ?? null} fallback="5h" />
              <LimitLine window={account?.limits?.secondary ?? null} fallback="Weekly" />
              <button
                type="button"
                className="mt-1 flex h-8 w-full items-center justify-between rounded-lg text-left text-[15px] text-foreground hover:text-muted-foreground"
                onClick={() => void window.godeDesktop.codexOpenRateLimitHelp()}
              >
                Learn more
                <ExternalLink className="size-4 text-muted-foreground" />
              </button>
            </div>
          )}

          <div className="my-1 h-px bg-border/70" />

          {account?.godeSignedIn ? (
            <button
              type="button"
              className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-foreground outline-none hover:bg-accent disabled:opacity-60"
              disabled={busy === "logout"}
              onClick={() => void logout()}
            >
              {busy === "logout" ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              Log out
            </button>
          ) : (
            <button
              type="button"
              className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-foreground outline-none hover:bg-accent disabled:opacity-60"
              disabled={busy === "login" || account?.loginPending}
              onClick={() => void login()}
            >
              {busy === "login" || account?.loginPending ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              {account?.loginPending ? "Opening browser..." : "Log in with Codex"}
            </button>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function MenuRow({
  icon,
  label,
  detail,
  muted = false,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  muted?: boolean;
}): React.JSX.Element {
  return (
    <div className={cn("flex h-10 items-center gap-3 rounded-xl px-3", muted ? "text-muted-foreground" : "text-foreground")}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && <span className="shrink-0 text-[13px] uppercase tracking-normal">{detail}</span>}
    </div>
  );
}

function LimitLine({ window, fallback }: { window: CodexRateWindow | null; fallback: string }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-[15px]">
      <span className="truncate text-foreground">{window?.label ?? fallback}</span>
      <span className="font-mono text-muted-foreground">{window ? `${Math.round(window.remainingPercent)}%` : "--"}</span>
      <span className="w-14 text-right font-mono text-muted-foreground">{window?.resetLabel || "--"}</span>
    </div>
  );
}

function initials(value: string): string {
  const [first = "G", second = ""] = value.replace(/@.*/, "").split(/[.\s_-]+/).filter(Boolean);
  return `${first[0] ?? "G"}${second[0] ?? ""}`.toUpperCase();
}
