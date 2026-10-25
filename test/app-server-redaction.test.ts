import { describe, expect, it } from "vitest";
import { redactSecrets } from "../electron/app-server-redaction";

describe("redactSecrets", () => {
  it("removes API keys from request params before they are recorded", () => {
    expect(redactSecrets({ provider: "opencode", api_key: "sk-live-123" })).toEqual({
      provider: "opencode",
      api_key: "[redacted]",
    });
  });

  it("redacts secrets nested inside arrays and objects", () => {
    expect(
      redactSecrets({
        selection: { provider: "openrouter", apiKey: "sk-or-1" },
        providers: [{ id: "deepseek", api_key: "sk-ds-1" }],
        auth: { authorization: "Bearer abc" },
        refresh_token: "rt-1",
      }),
    ).toEqual({
      selection: { provider: "openrouter", apiKey: "[redacted]" },
      providers: [{ id: "deepseek", api_key: "[redacted]" }],
      auth: { authorization: "[redacted]" },
      refresh_token: "[redacted]",
    });
  });

  it("leaves ordinary params untouched", () => {
    const params = { threadId: "thread-1", model: "claude-opus-5-5", tokens: 12, cwd: "/tmp/project" };
    expect(redactSecrets(params)).toEqual(params);
  });

  it("passes primitives through", () => {
    expect(redactSecrets("plain")).toBe("plain");
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(7)).toBe(7);
  });
});
