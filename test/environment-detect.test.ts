import { describe, expect, it } from "vitest";
import { detectEnvironmentProviders } from "../electron/onboarding/environment";

describe("detectEnvironmentProviders", () => {
  it("reports each provider whose API key variable is set, by variable name only", () => {
    const detected = detectEnvironmentProviders({
      OPENROUTER_API_KEY: "sk-or-secret-value",
      OPENAI_API_KEY: "sk-openai-secret",
      PATH: "/usr/bin",
    });

    expect(detected).toEqual([
      { providerId: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" },
      { providerId: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY" },
    ]);
    expect(JSON.stringify(detected)).not.toContain("secret");
  });

  it("ignores blank values, so an exported but empty variable does not count", () => {
    expect(detectEnvironmentProviders({ DEEPSEEK_API_KEY: "   ", OPENAI_API_KEY: "" })).toEqual([]);
  });

  it("uses the first variable a provider accepts", () => {
    expect(detectEnvironmentProviders({ GOOGLE_API_KEY: "g-1", GEMINI_API_KEY: "g-2" })).toEqual([
      { providerId: "gemini", label: "Google Gemini", envVar: "GEMINI_API_KEY" },
    ]);
    expect(detectEnvironmentProviders({ RODER_CURSOR_API_KEY: "c-1" })).toEqual([
      { providerId: "cursor", label: "Cursor", envVar: "RODER_CURSOR_API_KEY" },
    ]);
  });

  it("returns nothing for an empty environment", () => {
    expect(detectEnvironmentProviders({})).toEqual([]);
  });
});
