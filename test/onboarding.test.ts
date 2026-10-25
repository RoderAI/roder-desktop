import { describe, expect, it } from "vitest";
import {
  canContinueFromProviders,
  describeAutoDetected,
  groupProvidersForOnboarding,
  isProviderReady,
  nextOnboardingStep,
  onboardingGate,
  onboardingSteps,
  pickDefaultModel,
  previousOnboardingStep,
  providerSetupKind,
  providerStatusLabel,
  hasExistingSetup,
} from "../src/lib/onboarding";
import type { ProviderDescriptor, RoderModel } from "../src/types/roder";

function provider(overrides: Partial<ProviderDescriptor> & { id: string }): ProviderDescriptor {
  return {
    name: overrides.id,
    authType: "api_key",
    authenticated: false,
    models: [],
    ...overrides,
  };
}

function model(provider: string, id: string, overrides: Partial<RoderModel> = {}): RoderModel {
  return { id, name: id, modelProvider: provider, ...overrides };
}

describe("onboarding steps", () => {
  it("walks forward and backward and clamps at both ends", () => {
    expect(onboardingSteps).toEqual(["welcome", "providers", "models", "project", "ready"]);
    expect(nextOnboardingStep("welcome")).toBe("providers");
    expect(nextOnboardingStep("ready")).toBe("ready");
    expect(previousOnboardingStep("providers")).toBe("welcome");
    expect(previousOnboardingStep("welcome")).toBe("welcome");
  });
});

describe("onboardingGate", () => {
  const base = {
    loaded: true,
    completed: false,
    hydrated: true,
    engineState: "ready" as const,
    hasExistingSetup: false,
  };

  it("waits until the onboarded flag has been read, so a completed user never sees the flow flash", () => {
    expect(onboardingGate({ ...base, loaded: false })).toBe("wait");
    expect(onboardingGate({ ...base, loaded: false, completed: true })).toBe("wait");
  });

  it("waits until bootstrap has finished before deciding", () => {
    expect(onboardingGate({ ...base, hydrated: false })).toBe("wait");
  });

  it("shows onboarding for a fresh install with a healthy engine", () => {
    expect(onboardingGate(base)).toBe("onboarding");
  });

  it("never shows onboarding again once completed", () => {
    expect(onboardingGate({ ...base, completed: true })).toBe("app");
    expect(onboardingGate({ ...base, completed: true, hydrated: false })).toBe("app");
  });

  it("does not block users who already have a setup", () => {
    expect(onboardingGate({ ...base, hasExistingSetup: true })).toBe("app");
  });

  it("falls through to the app when the engine failed, so its own error UI shows", () => {
    expect(onboardingGate({ ...base, engineState: "error" })).toBe("app");
    expect(onboardingGate({ ...base, engineState: "stopped" })).toBe("app");
  });
});

describe("hasExistingSetup", () => {
  it("counts threads as an existing setup", () => {
    expect(hasExistingSetup({ threadCount: 1 })).toBe(true);
  });

  it("does not count keys or sign-ins found on the machine, so new users still see them ticked", () => {
    expect(hasExistingSetup({ threadCount: 0 })).toBe(false);
  });
});

describe("describeAutoDetected", () => {
  it("explains an environment key that Roder has loaded, without any value", () => {
    const items = describeAutoDetected({
      environment: [{ providerId: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY" }],
      claudeCli: null,
      providers: [provider({ id: "openrouter", authenticated: true })],
    });

    expect(items).toEqual([
      {
        id: "env:openrouter",
        title: "OpenRouter",
        detail: "Using OPENROUTER_API_KEY from your environment. Nothing is copied into Roder.",
        tone: "ready",
      },
    ]);
  });

  it("warns when a variable is set but the backend has not loaded it", () => {
    const [item] = describeAutoDetected({
      environment: [{ providerId: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" }],
      claudeCli: null,
      providers: [provider({ id: "openai", authenticated: false })],
    });

    expect(item).toMatchObject({ tone: "warning", title: "OpenAI" });
    expect(item.detail).toContain("Restart Roder");
  });

  it("lists an installed Claude Code CLI and signed-in ChatGPT and xAI accounts", () => {
    const items = describeAutoDetected({
      environment: [],
      claudeCli: { installed: true, onPath: true, runnable: true, path: "/usr/local/bin/claude" },
      providers: [
        provider({ id: "codex", authType: "oauth", authenticated: true }),
        provider({ id: "supergrok", authType: "oauth", authenticated: true }),
      ],
    });

    expect(items.map((item) => item.title)).toEqual(["Claude Code", "ChatGPT", "xAI"]);
    expect(items[0]).toMatchObject({ tone: "ready" });
    expect(items[0].detail).toContain("/usr/local/bin/claude");
  });

  it("flags a Claude Code CLI that is installed but cannot run", () => {
    const [item] = describeAutoDetected({
      environment: [],
      claudeCli: { installed: true, onPath: true, runnable: false, path: "/opt/homebrew/bin/claude" },
      providers: [],
    });

    expect(item).toMatchObject({ title: "Claude Code", tone: "warning" });
  });

  it("returns nothing on a bare machine", () => {
    expect(
      describeAutoDetected({
        environment: [],
        claudeCli: { installed: false, onPath: false, runnable: false, path: null },
        providers: [provider({ id: "codex", authType: "oauth" })],
      }),
    ).toEqual([]);
  });
});

describe("providerSetupKind", () => {
  it("hides the mock provider from setup entirely", () => {
    expect(providerSetupKind({ id: "mock", authType: "none" })).toBe("hidden");
  });

  it("routes each featured provider to its own sign-in path", () => {
    expect(providerSetupKind({ id: "claude-code", authType: "none" })).toBe("claude-cli");
    expect(providerSetupKind({ id: "codex", authType: "oauth" })).toBe("codex-login");
    expect(providerSetupKind({ id: "supergrok", authType: "oauth" })).toBe("oauth-rpc");
    expect(providerSetupKind({ id: "kimi-code", authType: "oauth" })).toBe("oauth-rpc");
    expect(providerSetupKind({ id: "opencode", authType: "api_key" })).toBe("api-key");
  });

  it("sends unknown OAuth providers to Settings rather than offering a broken button", () => {
    expect(providerSetupKind({ id: "vertex", authType: "oauth" })).toBe("settings");
  });
});

describe("isProviderReady", () => {
  const claudeInstalled = { installed: true, onPath: true, runnable: true };

  it("treats Claude Code as ready only when the CLI is installed, on PATH, and starts", () => {
    const claude = provider({ id: "claude-code", authType: "none", authenticated: true });
    expect(isProviderReady(claude, claudeInstalled)).toBe(true);
    expect(isProviderReady(claude, { installed: true, onPath: false, runnable: true })).toBe(false);
    expect(isProviderReady(claude, { installed: true, onPath: true, runnable: false })).toBe(false);
    expect(isProviderReady(claude, { installed: false, onPath: false, runnable: false })).toBe(false);
    expect(isProviderReady(claude, null)).toBe(false);
  });

  it("uses the backend's authenticated flag for every other provider", () => {
    expect(isProviderReady(provider({ id: "opencode", authenticated: true }), null)).toBe(true);
    expect(isProviderReady(provider({ id: "opencode", authenticated: false }), null)).toBe(false);
  });

  it("never treats the hidden mock provider as ready", () => {
    expect(isProviderReady(provider({ id: "mock", authType: "none", authenticated: true }), claudeInstalled)).toBe(
      false,
    );
  });
});

describe("groupProvidersForOnboarding", () => {
  it("puts featured providers first in onboarding order and the rest after, without mock", () => {
    const catalog = [
      provider({ id: "deepseek" }),
      provider({ id: "opencode" }),
      provider({ id: "mock", authType: "none" }),
      provider({ id: "codex", authType: "oauth" }),
      provider({ id: "claude-code", authType: "none" }),
      provider({ id: "supergrok", authType: "oauth" }),
    ];

    const { featured, more } = groupProvidersForOnboarding(catalog);

    expect(featured.map((item) => item.id)).toEqual(["claude-code", "codex", "supergrok", "opencode"]);
    expect(more.map((item) => item.id)).toEqual(["deepseek"]);
  });
});

describe("canContinueFromProviders", () => {
  it("requires at least one ready provider", () => {
    expect(canContinueFromProviders(0)).toBe(false);
    expect(canContinueFromProviders(1)).toBe(true);
  });
});

describe("pickDefaultModel", () => {
  it("returns null when no ready provider has a model", () => {
    expect(pickDefaultModel([model("opencode", "zen-1")], new Set())).toBeNull();
  });

  it("prefers the featured provider order, then the backend's default flag", () => {
    const models = [
      model("deepseek", "deepseek-chat", { isDefault: true }),
      model("codex", "gpt-5-codex"),
      model("claude-code", "claude-opus-5-5"),
      model("claude-code", "claude-haiku-5-5", { isDefault: true }),
    ];
    const ready = new Set(["deepseek", "codex", "claude-code"]);

    expect(pickDefaultModel(models, ready)).toEqual(models[3]);
  });

  it("ignores models from providers that are not ready", () => {
    const models = [model("claude-code", "claude-opus-5-5"), model("codex", "gpt-6")];

    expect(pickDefaultModel(models, new Set(["codex"]))).toEqual(models[1]);
  });

  it("keeps the current default when it is still available", () => {
    const models = [model("claude-code", "claude-opus-5-5"), model("codex", "gpt-6")];
    const ready = new Set(["claude-code", "codex"]);

    expect(pickDefaultModel(models, ready, { id: "gpt-6", provider: "codex" })).toEqual(models[1]);
  });
});

describe("providerStatusLabel", () => {
  it("says where a connected provider came from", () => {
    expect(providerStatusLabel({ ready: true })).toBe("Connected");
    expect(providerStatusLabel({ ready: true, environmentVar: "OPENROUTER_API_KEY" })).toBe("From environment");
    expect(providerStatusLabel({ ready: false, environmentVar: "OPENROUTER_API_KEY" })).toBe("Not connected");
  });
});
