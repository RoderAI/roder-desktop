import type { ClaudeCliStatus, EnvironmentProvider, ProviderDescriptor, RoderModel, RoderStatus } from "@/types/roder";

export const onboardingSteps = ["welcome", "providers", "models", "project", "ready"] as const;

/** Matches the renderer's `min-width` on html/body, so the flow never clips at the window edge. */
export const onboardingMinWindowWidth = 960;

export type OnboardingStep = (typeof onboardingSteps)[number];

export function onboardingStepIndex(step: OnboardingStep): number {
  return onboardingSteps.indexOf(step);
}

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep {
  return onboardingSteps[Math.min(onboardingStepIndex(step) + 1, onboardingSteps.length - 1)];
}

export function previousOnboardingStep(step: OnboardingStep): OnboardingStep {
  return onboardingSteps[Math.max(onboardingStepIndex(step) - 1, 0)];
}

export type OnboardingGate = "wait" | "onboarding" | "app";

/**
 * Decides whether the first-run flow replaces the app shell.
 * - "wait": the onboarded flag or bootstrap has not loaded yet, so the app cannot decide yet.
 * - "app": onboarding was completed, the user already has a setup, or the engine failed (the shell
 *   shows its own error state instead of a setup flow that cannot work).
 */
export function onboardingGate(input: {
  loaded: boolean;
  completed: boolean;
  hydrated: boolean;
  engineState: RoderStatus["state"] | null;
  hasExistingSetup: boolean;
}): OnboardingGate {
  if (!input.loaded) {
    return "wait";
  }
  if (input.completed) {
    return "app";
  }
  if (!input.hydrated) {
    return "wait";
  }
  if (input.engineState === "error" || input.engineState === "stopped") {
    return "app";
  }
  return input.hasExistingSetup ? "app" : "onboarding";
}

/**
 * A returning user has threads. Keys and sign-ins found on this machine do not count: they are shown
 * as ticked in the flow, so a new user with an API key in their environment still sees the setup.
 */
export function hasExistingSetup(input: { threadCount: number }): boolean {
  return input.threadCount > 0;
}

export type ProviderSetupKind = "hidden" | "claude-cli" | "codex-login" | "oauth-rpc" | "api-key" | "settings";

/** Auth flows the desktop can start itself, keyed by provider id. The backend persists these tokens. */
export const oauthLoginMethods: Readonly<Record<string, string>> = {
  supergrok: "auth/supergrok/login",
  "kimi-code": "auth/kimi-code/login",
};

export function providerSetupKind(provider: Pick<ProviderDescriptor, "id" | "authType">): ProviderSetupKind {
  if (provider.id === "mock") {
    return "hidden";
  }
  if (provider.id === "claude-code") {
    return "claude-cli";
  }
  if (provider.id === "codex") {
    return "codex-login";
  }
  if (provider.authType === "oauth" && oauthLoginMethods[provider.id]) {
    return "oauth-rpc";
  }
  if (provider.authType === "api_key") {
    return "api-key";
  }
  return "settings";
}

export type ClaudeCliState = { installed: boolean; onPath: boolean; runnable: boolean } | null;

/**
 * The backend always reports claude-code as authenticated, so its readiness comes from the local CLI.
 * The CLI must start and must be on the PATH the app-server inherits, or inference fails later.
 */
export function isProviderReady(provider: ProviderDescriptor, claudeCli: ClaudeCliState): boolean {
  const kind = providerSetupKind(provider);
  if (kind === "hidden") {
    return false;
  }
  if (kind === "claude-cli") {
    return claudeCli?.installed === true && claudeCli.onPath === true && claudeCli.runnable === true;
  }
  return provider.authenticated === true;
}

export const featuredProviderIds = ["claude-code", "codex", "supergrok", "opencode"] as const;

export function groupProvidersForOnboarding(providers: ProviderDescriptor[]): {
  featured: ProviderDescriptor[];
  more: ProviderDescriptor[];
} {
  const visible = providers.filter((provider) => providerSetupKind(provider) !== "hidden");
  const featured = featuredProviderIds.flatMap((id) => visible.filter((provider) => provider.id === id));
  const more = visible.filter((provider) => !(featuredProviderIds as readonly string[]).includes(provider.id));
  return { featured, more };
}

export function canContinueFromProviders(readyCount: number): boolean {
  return readyCount > 0;
}

function providerRank(providerId: string): number {
  const index = (featuredProviderIds as readonly string[]).indexOf(providerId);
  return index === -1 ? featuredProviderIds.length : index;
}

/**
 * The first model to make the default. A current default that is still available always wins;
 * otherwise featured providers come first, then the backend's own default, then catalog order.
 */
export function pickDefaultModel(
  models: RoderModel[],
  readyProviderIds: ReadonlySet<string>,
  current?: { id: string; provider: string } | null,
): RoderModel | null {
  const candidates = models.filter((model) => readyProviderIds.has(model.modelProvider));
  const kept = current
    ? candidates.find((model) => model.id === current.id && model.modelProvider === current.provider)
    : undefined;
  if (kept) {
    return kept;
  }
  const ranked = candidates
    .map((model, index) => ({ model, index }))
    .sort(
      (left, right) =>
        providerRank(left.model.modelProvider) - providerRank(right.model.modelProvider) ||
        Number(right.model.isDefault === true) - Number(left.model.isDefault === true) ||
        left.index - right.index,
    );
  return ranked[0]?.model ?? null;
}

export type AutoDetectedItem = {
  id: string;
  title: string;
  detail: string;
  tone: "ready" | "warning";
};

const signedInProviderTitles: Readonly<Record<string, string>> = {
  codex: "ChatGPT",
  supergrok: "xAI",
  "kimi-code": "Kimi Code",
};

/**
 * What the flow found on this machine, written as sentences the user can check. Environment keys are
 * named by variable only; their values are never read here or stored anywhere.
 */
export function describeAutoDetected(input: {
  environment: EnvironmentProvider[];
  claudeCli: ClaudeCliStatus | null;
  providers: ProviderDescriptor[];
}): AutoDetectedItem[] {
  const items: AutoDetectedItem[] = [];

  for (const found of input.environment) {
    const provider = input.providers.find((candidate) => candidate.id === found.providerId);
    const loaded = provider?.authenticated === true;
    items.push({
      id: `env:${found.providerId}`,
      title: found.label,
      detail: loaded
        ? `Using ${found.envVar} from your environment. Nothing is copied into Roder.`
        : `${found.envVar} is set, but Roder has not loaded it yet. Restart Roder to pick it up.`,
      tone: loaded ? "ready" : "warning",
    });
  }

  if (input.claudeCli?.installed) {
    const usable = input.claudeCli.onPath && input.claudeCli.runnable;
    items.push({
      id: "claude-cli",
      title: "Claude Code",
      detail: usable
        ? `Installed at ${input.claudeCli.path}. Roder uses the Claude session that CLI already has.`
        : `Found at ${input.claudeCli.path}, but Roder cannot run it yet.`,
      tone: usable ? "ready" : "warning",
    });
  }

  for (const provider of input.providers) {
    const title = signedInProviderTitles[provider.id];
    if (title && provider.authenticated === true) {
      items.push({
        id: `signed-in:${provider.id}`,
        title,
        detail: "Already signed in on this machine.",
        tone: "ready",
      });
    }
  }

  return items;
}

/** The one-line status shown on a provider row or card. Environment-found providers say where they came from. */
export function providerStatusLabel(input: { ready: boolean; environmentVar?: string }): string {
  if (!input.ready) {
    return "Not connected";
  }
  return input.environmentVar ? "From environment" : "Connected";
}
