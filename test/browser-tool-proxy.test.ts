import { expect, test } from "vitest";
import {
  browserProviderFromPrompt,
  browserProviderFromRequestParams,
  browserSkill,
  callChromeBrowserToolAlias,
  callDesktopBrowserTool,
  chromeSkill,
  desktopBrowserToolName,
  mergeDesktopBrowserSkill,
  mergeDesktopBrowserTools,
} from "../electron/browser/browser-tool-proxy";

test("browser tool proxy merges desktop browser tools into tools/list", () => {
  const result = mergeDesktopBrowserTools({ tools: [{ name: "native", description: "Native", input_schema: {} }] });

  expect(result.tools?.map((tool) => tool.name)).toContain("browser_snapshot");
  expect(result.tools?.find((tool) => tool.name === "browser_snapshot")?.source).toBe("desktop-browser");
  expect(result.tools?.map((tool) => tool.name)).toContain("chrome_tab_open");
  expect(result.tools?.find((tool) => tool.name === "chrome_tab_open")?.source).toBe("desktop-browser");
});

test("browser tool proxy shadows backend chrome tools with desktop browser aliases", () => {
  const result = mergeDesktopBrowserTools({
    tools: [{ name: "chrome_tab_open", description: "Backend Chrome extension", input_schema: {}, source: "chrome" }],
  });

  expect(result.tools?.filter((tool) => tool.name === "chrome_tab_open")).toHaveLength(1);
  expect(result.tools?.find((tool) => tool.name === "chrome_tab_open")?.source).toBe("desktop-browser");
});

test("browser tool proxy detects browser tool calls", () => {
  expect(desktopBrowserToolName({ tool_name: "browser_navigate" })).toBe("browser_navigate");
  expect(desktopBrowserToolName({ name: "browser_snapshot" })).toBe("browser_snapshot");
  expect(desktopBrowserToolName({ tool_name: "shell" })).toBeUndefined();
});

test("browser tool proxy accepts common chrome tool aliases", () => {
  expect(desktopBrowserToolName({ name: "chrome_tab_open" })).toBe("browser_navigate");
  expect(desktopBrowserToolName({ tool_name: "chrome_eval" })).toBe("browser_evaluate");
  expect(desktopBrowserToolName({ name: "chrome_unknown" })).toBeUndefined();
});

test("browser tool proxy executes calls through BrowserManager", async () => {
  const browser = {
    ensureVisible: () => ({ visible: true }),
    navigate: (url: string) => ({ url, visible: true }),
    waitForLoad: async () => ({ loaded: true }),
  };

  const result = await callDesktopBrowserTool(browser as never, "browser_navigate", {
    arguments: { url: "example.com" },
  });

  expect(result).toEqual({
    text: '{"url":"example.com","visible":true}',
    data: { url: "example.com", visible: true },
    is_error: false,
  });
});

test("browser tool proxy reports invalid input as tool errors", async () => {
  const result = await callDesktopBrowserTool(
    { ensureVisible: () => ({ visible: true }) } as never,
    "browser_navigate",
    { arguments: {} },
  );

  expect(result.is_error).toBe(true);
  expect(result.text).toContain("url");
});

test("browser skill is injected as a built-in direct activation skill", () => {
  const result = mergeDesktopBrowserSkill({ skills: [], diagnostics: [] });

  expect(result.skills).toEqual([chromeSkill, browserSkill]);
  expect(browserSkill.name).toBe("browser");
  expect(browserSkill.canonicalPath).toBe("builtin://skills/browser/SKILL.md");
});

test("browser skill injection avoids duplicates from the app-server", () => {
  const existingChrome = { ...chromeSkill, description: "backend chrome skill" };
  const result = mergeDesktopBrowserSkill({
    skills: [existingChrome, { ...browserSkill, description: "old" }],
    diagnostics: [],
  });

  expect(result.skills).toHaveLength(2);
  expect(result.skills[0]).toBe(existingChrome);
  expect((result.skills[1] as typeof browserSkill).description).toBe(browserSkill.description);
});

test("browser provider parsing lets the latest explicit skill pick the session provider", () => {
  expect(browserProviderFromPrompt("use $chrome to inspect this")).toBe("chrome");
  expect(browserProviderFromPrompt("use ${chrome} then $browser now")).toBe("builtIn");
  expect(browserProviderFromPrompt("leave $chromedriver alone")).toBeNull();
  expect(browserProviderFromRequestParams({ input: [{ type: "text", text: "debug with $chrome" }] })).toBe("chrome");
});

test("chrome browser tool alias delegates browser calls to chrome app-server methods", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const request = async (method: string, params?: unknown) => {
    calls.push({ method, params });
    return { ok: true };
  };

  const result = await callChromeBrowserToolAlias(request, "browser_click", { arguments: { ref: "node-1" } });

  expect(result).toEqual({ text: '{"ok":true}', data: { ok: true }, is_error: false });
  expect(calls).toEqual([{ method: "chrome/page/action", params: { action: "click", ref: "node-1" } }]);
});

test("chrome browser tool alias maps navigation and snapshot to chrome bridge methods", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const request = async (method: string, params?: unknown) => {
    calls.push({ method, params });
    return { ok: true };
  };

  await callChromeBrowserToolAlias(request, "browser_navigate", { arguments: { url: "https://example.com" } });
  await callChromeBrowserToolAlias(request, "browser_snapshot", { arguments: {} });

  expect(calls).toEqual([
    { method: "chrome/tabs/navigate", params: { url: "https://example.com" } },
    { method: "chrome/page/snapshot", params: { include: ["aria", "forms", "boxes"] } },
  ]);
});
