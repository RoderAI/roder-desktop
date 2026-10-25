import { useEffect, useState } from "react";
import type { ClaudeCliStatus, EnvironmentProvider } from "@/types/roder";

/** A failed read counts as "not found", so the card offers Check again instead of waiting forever. */
async function readClaudeCliStatus(): Promise<ClaudeCliStatus> {
  try {
    return await window.roderDesktop.claudeCliStatus();
  } catch {
    return { installed: false, onPath: false, runnable: false, path: null };
  }
}

/** An unreadable environment means nothing is reported as found; the UI still works without it. */
async function readEnvironmentProviders(): Promise<EnvironmentProvider[]> {
  try {
    return await window.roderDesktop.onboardingEnvironment();
  } catch {
    return [];
  }
}

/**
 * What the desktop found on this machine: the Claude Code CLI and API keys already set in the environment.
 * Shared by onboarding and Settings > Providers so both show the same picture.
 */
export function useProviderSetupState(): {
  claudeCli: ClaudeCliStatus | null;
  environment: EnvironmentProvider[];
  recheckClaudeCli: () => Promise<void>;
} {
  const [claudeCli, setClaudeCli] = useState<ClaudeCliStatus | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentProvider[]>([]);

  useEffect(() => {
    let cancelled = false;
    void readClaudeCliStatus().then((status) => {
      if (!cancelled) {
        setClaudeCli(status);
      }
    });
    void readEnvironmentProviders().then((found) => {
      if (!cancelled) {
        setEnvironment(found);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function recheckClaudeCli(): Promise<void> {
    setClaudeCli(await readClaudeCliStatus());
  }

  return { claudeCli, environment, recheckClaudeCli };
}
