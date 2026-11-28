import { useEffect, useState } from "react";
import type { AntigravityStatus, ClaudeCliStatus, EnvironmentProvider } from "@/types/roder";

const emptyAntigravityStatus: AntigravityStatus = {
  state: "disconnected",
  runtimeInstalled: false,
  runtimePath: null,
  connected: false,
  modelCount: 0,
  error: null,
};

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

async function readAntigravityStatus(): Promise<AntigravityStatus> {
  try {
    if (typeof window.roderDesktop?.antigravityStatus !== "function") {
      return emptyAntigravityStatus;
    }
    return await window.roderDesktop.antigravityStatus();
  } catch {
    return emptyAntigravityStatus;
  }
}

/**
 * What the desktop found on this machine: the Claude Code CLI, Antigravity CLI, and API keys already set in the environment.
 * Shared by onboarding and Settings > Providers so both show the same picture.
 */
export function useProviderSetupState(): {
  claudeCli: ClaudeCliStatus | null;
  antigravityStatus: AntigravityStatus | null;
  environment: EnvironmentProvider[];
  recheckClaudeCli: () => Promise<void>;
  recheckAntigravity: () => Promise<AntigravityStatus>;
} {
  const [claudeCli, setClaudeCli] = useState<ClaudeCliStatus | null>(null);
  const [antigravityStatus, setAntigravityStatus] = useState<AntigravityStatus | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentProvider[]>([]);

  useEffect(() => {
    let cancelled = false;
    void readClaudeCliStatus().then((status) => {
      if (!cancelled) {
        setClaudeCli(status);
      }
    });
    void readAntigravityStatus().then((status) => {
      if (!cancelled) {
        setAntigravityStatus(status);
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

  async function recheckAntigravity(): Promise<AntigravityStatus> {
    const status = await readAntigravityStatus();
    setAntigravityStatus(status);
    return status;
  }

  return { claudeCli, antigravityStatus, environment, recheckClaudeCli, recheckAntigravity };
}
