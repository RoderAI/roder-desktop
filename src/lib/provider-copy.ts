/** Display copy, sign-in method labels, and key-page links for each provider id. Pure data. */

export type ProviderCopy = {
  title: string;
  description: string;
  method: string;
  signInLabel?: string;
  /** Where the provider issues API keys. Only used to open the page in the system browser. */
  apiKeyUrl?: string;
};

export const providerCopy: Readonly<Record<string, ProviderCopy>> = {
  "claude-code": {
    title: "Claude",
    description: "Claude models through your Claude subscription, using the Claude Code CLI.",
    method: "Claude subscription",
  },
  codex: {
    title: "ChatGPT",
    description: "GPT and Codex models with your ChatGPT Plus or Pro plan.",
    method: "ChatGPT sign-in",
    signInLabel: "Sign in with ChatGPT",
  },
  supergrok: {
    title: "xAI",
    description: "Grok models with your SuperGrok subscription.",
    method: "SuperGrok sign-in",
    signInLabel: "Sign in with SuperGrok",
  },
  opencode: {
    title: "OpenCode Zen",
    description: "A curated set of coding models behind one OpenCode API key.",
    method: "API key",
    apiKeyUrl: "https://opencode.ai/auth",
  },
  "opencode-go": {
    title: "OpenCode Go",
    description: "Open coding models from the OpenCode Go plan.",
    method: "API key",
    apiKeyUrl: "https://opencode.ai/auth",
  },
  "kimi-code": {
    title: "Kimi Code",
    description: "Kimi coding models with your Kimi Code subscription.",
    method: "Kimi sign-in",
    signInLabel: "Sign in with Kimi",
  },
  openrouter: {
    title: "OpenRouter",
    description: "One API key for models from many labs.",
    method: "API key",
    apiKeyUrl: "https://openrouter.ai/keys",
  },
  fireworks: {
    title: "Fireworks AI",
    description: "Fast open-weight models hosted by Fireworks.",
    method: "API key",
    apiKeyUrl: "https://fireworks.ai/account/api-keys",
  },
  openai: {
    title: "OpenAI",
    description: "GPT models through the OpenAI API.",
    method: "API key",
    apiKeyUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    title: "Anthropic API",
    description: "Claude models through the Anthropic API.",
    method: "API key",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
  },
  gemini: {
    title: "Google Gemini",
    description: "Gemini models through Google AI Studio.",
    method: "API key",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
  },
  xai: {
    title: "xAI API",
    description: "Grok models through the xAI API.",
    method: "API key",
    apiKeyUrl: "https://console.x.ai",
  },
  cursor: {
    title: "Cursor",
    description: "Cursor Composer models through the Cursor agent API.",
    method: "API key",
    apiKeyUrl: "https://cursor.com/dashboard/api",
  },
  poolside: {
    title: "Poolside",
    description: "Laguna coding models from Poolside.",
    method: "API key",
    apiKeyUrl: "https://docs.poolside.ai/api/authentication",
  },
  "xiaomi-mimo": {
    title: "Xiaomi MiMo",
    description: "Xiaomi MiMo models through an OpenAI-compatible API.",
    method: "API key",
    apiKeyUrl: "https://platform.xiaomimimo.com",
  },
  deepseek: {
    title: "DeepSeek",
    description: "DeepSeek chat and reasoning models.",
    method: "API key",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
  },
};

export function authTypeLabel(authType: string | undefined): string {
  if (authType === "api_key") {
    return "API key";
  }
  if (authType === "oauth") {
    return "Sign-in";
  }
  if (authType === "none") {
    return "Built in";
  }
  return "Setup";
}
