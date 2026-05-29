import { ChevronDown, Gauge, Loader2, LogIn, LogOut, Settings, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CodexAccountSnapshot, CodexRateWindow } from "@/types/roder";
import { useThemeStore } from "@/stores/theme-store";

/*
 * RATE LIMIT PANEL STORYBOARD
 *
 * Read top-to-bottom. Values are relative to the disclosure toggle.
 *
 *   0ms   panel row starts at its current size
 * 200ms   grid row opens/closes while content fades and slides 2px -> 0
 */
const RATE_LIMIT_PANEL_ANIMATION = {
  durationClassName: "duration-200",
  easingClassName: "ease-out",
};

const disconnectedAccount: CodexAccountSnapshot = {
  signedIn: false,
  codexSignedIn: false,
  roderSignedIn: false,
  displayName: null,
  planType: null,
  accountId: null,
  limits: null,
  loginPending: false,
};

export function SidebarAccountMenu(): React.JSX.Element {
  const [account, setAccount] = useState<CodexAccountSnapshot | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(true);
  const [busy, setBusy] = useState<"login" | "logout" | null>(null);
  const openSettings = useThemeStore((state) => state.openSettings);
  const accountLoading = account === undefined;

  useEffect(() => {
    let cancelled = false;
    void window.roderDesktop
      .codexAccount()
      .catch(() => disconnectedAccount)
      .then((snapshot) => {
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
    setAccount(await window.roderDesktop.codexAccount().catch(() => disconnectedAccount));
  }

  async function login(): Promise<void> {
    setBusy("login");
    try {
      setAccount(await window.roderDesktop.codexLogin());
    } finally {
      setBusy(null);
    }
  }

  async function logout(): Promise<void> {
    setBusy("logout");
    try {
      setAccount(await window.roderDesktop.codexLogout());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="no-drag shrink-0 border-t border-border/70 p-3">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({ variant: "ghost" }),
            "squircle-corners h-12 w-full justify-start gap-3 rounded-xl px-2.5 text-base text-sidebar-foreground hover:bg-sidebar-accent",
          )}
          disabled={accountLoading}
          onClick={() => void refresh()}
        >
          <SidebarAccountTriggerContent account={account} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-72">
          <DropdownMenuGroup>
            <DropdownMenuItem className="h-9 px-2" onSelect={() => openSettings()}>
              <Settings className="size-4" />
              Settings
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-base text-popover-foreground outline-none hover:bg-accent"
            onClick={() => setLimitsOpen((value) => !value)}
          >
            <Gauge className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Rate limits remaining</span>
            <ChevronDown
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform", limitsOpen && "rotate-180")}
            />
          </button>

          <AnimatedRateLimitPanel open={limitsOpen}>
            <>
              <LimitLine window={account?.limits?.primary ?? null} fallback="5h" />
              <LimitLine window={account?.limits?.secondary ?? null} fallback="Weekly" />
            </>
          </AnimatedRateLimitPanel>

          {account?.roderSignedIn ? (
            <button
              type="button"
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-base text-popover-foreground outline-none hover:bg-accent disabled:opacity-60"
              disabled={busy === "logout"}
              onClick={() => void logout()}
            >
              {busy === "logout" ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              Log out
            </button>
          ) : (
            <button
              type="button"
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-base text-popover-foreground outline-none hover:bg-accent disabled:opacity-60"
              disabled={busy === "login" || account?.loginPending}
              onClick={() => void login()}
            >
              {busy === "login" || account?.loginPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogIn className="size-4" />
              )}
              {account?.loginPending ? "Opening browser..." : "Log in with Codex"}
            </button>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AnimatedRateLimitPanel({ children, open }: { children: React.ReactNode; open: boolean }): React.JSX.Element {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        "grid transition-[grid-template-rows] motion-reduce:transition-none",
        RATE_LIMIT_PANEL_ANIMATION.durationClassName,
        RATE_LIMIT_PANEL_ANIMATION.easingClassName,
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      <div
        className={cn(
          "min-h-0 overflow-hidden transition-[opacity,transform] motion-reduce:transition-none",
          RATE_LIMIT_PANEL_ANIMATION.durationClassName,
          RATE_LIMIT_PANEL_ANIMATION.easingClassName,
          open ? "translate-y-0 opacity-100" : "-translate-y-0.5 opacity-0",
        )}
      >
        <div className="space-y-2 px-2 py-3">{children}</div>
      </div>
    </div>
  );
}

export function SidebarAccountTriggerContent({
  account,
}: {
  account: CodexAccountSnapshot | undefined;
}): React.JSX.Element {
  if (account === undefined) {
    return (
      <>
        <div
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-active/50"
          aria-hidden="true"
        >
          <Skeleton className="size-4 rounded-full bg-sidebar-muted/30" />
        </div>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 text-left" aria-hidden="true">
          <Skeleton className="h-3 w-28 rounded-full bg-sidebar-muted/25" />
          <Skeleton className="h-3 w-20 rounded-full bg-sidebar-muted/20" />
        </span>
        <span className="sr-only">Loading Codex account</span>
        <SlidersHorizontal className="size-4 shrink-0 text-sidebar-muted/60" aria-hidden="true" />
      </>
    );
  }

  const label = account.roderSignedIn ? (account.displayName ?? "Codex account") : "Sign in to Codex";
  const secondary = account.roderSignedIn
    ? undefined
    : account.codexSignedIn
      ? "Codex CLI detected"
      : "Connect provider";

  return (
    <>
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-active/50 text-sm text-sidebar-muted">
        {account.displayName ? initials(account.displayName) : "G"}
      </div>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sidebar-active-foreground">{label}</span>
        {secondary ? <span className="block truncate text-base text-sidebar-muted">{secondary}</span> : null}
      </span>
      <SlidersHorizontal className="size-4 shrink-0 text-sidebar-muted" />
    </>
  );
}

function LimitLine({ window, fallback }: { window: CodexRateWindow | null; fallback: string }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_5rem] items-center gap-3 text-base">
      <span className="truncate text-popover-foreground">{window?.label ?? fallback}</span>
      <span className="text-right font-mono tabular-nums text-muted-foreground">
        {window ? `${Math.round(window.remainingPercent)}%` : "--"}
      </span>
      <span className="whitespace-nowrap text-right font-mono tabular-nums text-muted-foreground">
        {window?.resetLabel || "--"}
      </span>
    </div>
  );
}

function initials(value: string): string {
  const [first = "G", second = ""] = value
    .replace(/@.*/, "")
    .split(/[.\s_-]+/)
    .filter(Boolean);
  return `${first[0] ?? "G"}${second[0] ?? ""}`.toUpperCase();
}
