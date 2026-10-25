export type EnvironmentProvider = {
  providerId: string;
  label: string;
  /** The variable that matched. Only the name is reported; the value never leaves the main process. */
  envVar: string;
};

/**
 * Variables the backend reads for each API-key provider, in the order it checks them. Keep this in step
 * with the provider crates. A provider only appears when one of its variables is set to a non-empty value.
 */
const environmentKeyTable: ReadonlyArray<{ providerId: string; label: string; envVars: readonly string[] }> = [
  { providerId: "openai", label: "OpenAI", envVars: ["OPENAI_API_KEY"] },
  { providerId: "anthropic", label: "Anthropic", envVars: ["ANTHROPIC_API_KEY"] },
  { providerId: "xai", label: "xAI", envVars: ["XAI_API_KEY"] },
  { providerId: "gemini", label: "Google Gemini", envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
  { providerId: "openrouter", label: "OpenRouter", envVars: ["OPENROUTER_API_KEY"] },
  { providerId: "fireworks", label: "Fireworks AI", envVars: ["FIREWORKS_API_KEY"] },
  { providerId: "deepseek", label: "DeepSeek", envVars: ["DEEPSEEK_API_KEY"] },
  { providerId: "opencode", label: "OpenCode Zen", envVars: ["OPENCODE_API_KEY"] },
  { providerId: "opencode-go", label: "OpenCode Go", envVars: ["OPENCODE_GO_API_KEY"] },
  { providerId: "cursor", label: "Cursor", envVars: ["CURSOR_API_KEY", "RODER_CURSOR_API_KEY"] },
  { providerId: "synthetic", label: "Synthetic", envVars: ["SYNTHETIC_API_KEY", "RODER_SYNTHETIC_API_KEY"] },
  { providerId: "poolside", label: "Poolside", envVars: ["POOLSIDE_API_KEY"] },
  { providerId: "roder-cloud", label: "Roder Cloud", envVars: ["RODER_CLOUD_API_KEY"] },
  { providerId: "xiaomi-mimo", label: "Xiaomi MiMo", envVars: ["XIAOMI_MIMO_API_KEY"] },
];

/** Providers whose API key is already set in the environment the app was launched with. */
export function detectEnvironmentProviders(env: NodeJS.ProcessEnv): EnvironmentProvider[] {
  const detected: EnvironmentProvider[] = [];
  for (const entry of environmentKeyTable) {
    const envVar = entry.envVars.find((name) => (env[name] ?? "").trim().length > 0);
    if (envVar) {
      detected.push({ providerId: entry.providerId, label: entry.label, envVar });
    }
  }
  return detected;
}
