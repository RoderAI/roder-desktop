import type { JsonObject, JsonValue } from "@roderai/extension-api";
import type { BrowserManager } from "./browser-manager";
import type { ToolSpec, ToolsCallParams, ToolsCallResult, ToolsListResult } from "../extensions/tool-proxy";

export type BrowserToolProvider = "builtIn" | "chrome";

export const browserSkill = {
  id: "builtin:browser",
  name: "browser",
  canonicalPath: "builtin://skills/browser/SKILL.md",
  source: "builtIn" as const,
  exposure: "direct_only" as const,
  activation: "enabled" as const,
  experimental: false,
  diagnostics: [],
  shortDescription: "Use Roder Desktop's built-in browser.",
  description:
    "Use Roder Desktop's built-in browser through desktop browser tools. Activate when browsing, inspecting pages, clicking, typing, scrolling, evaluating page JavaScript, or taking browser screenshots. This desktop-only skill is the built-in-browser default and can be overridden for the session with $chrome.",
  agentMetadata: {
    raw: {
      instructions: [
        "Prefer desktop browser tools when the user chooses the built-in browser instead of the Chrome extension.",
        "Use browser_snapshot before acting when you need stable refs for click/type targets.",
        "Keep interactions visible to the user in the inbuilt Roder Desktop browser.",
      ],
    },
  },
};

export const chromeSkill = {
  id: "builtin:chrome",
  name: "chrome",
  canonicalPath: "roder-builtin://chrome/SKILL.md",
  source: "builtIn" as const,
  exposure: "direct_only" as const,
  activation: "enabled" as const,
  experimental: false,
  diagnostics: [],
  shortDescription: "Chrome extension browser",
  description:
    "Use the Roder Chrome extension and chrome_* tools. Invoking $chrome overrides the built-in browser default for this desktop session/thread until the user invokes $browser.",
  agentMetadata: {
    raw: {
      instructions: [
        "When $chrome is invoked, prefer chrome_* tools and the connected Chrome extension over built-in browser tools.",
        "If no Chrome extension is connected, report that state instead of silently falling back to the built-in browser.",
        "The user can switch back to Roder Desktop's built-in browser with $browser.",
      ],
    },
  },
};

export function mergeDesktopBrowserTools(baseResult: unknown): ToolsListResult {
  const base = isToolsListResult(baseResult) ? baseResult : {};
  const desktopTools = desktopBrowserToolSpecs();
  const desktopToolNames = new Set(desktopTools.map((tool) => tool.name));
  return {
    ...base,
    tools: [...(base.tools ?? []).filter((tool) => !desktopToolNames.has(tool.name)), ...desktopTools],
  };
}

export function mergeDesktopBrowserSkill(baseResult: unknown): { skills: unknown[]; diagnostics: unknown[] } {
  const base = isSkillsListResult(baseResult) ? baseResult : { skills: [], diagnostics: [] };
  const withoutDuplicate = base.skills.filter((skill) => {
    if (!isRecord(skill)) return true;
    return ![browserSkill.name, chromeSkill.name].includes(String(skill.name));
  });
  return {
    ...base,
    skills: [...withoutDuplicate, existingSkill(base.skills, chromeSkill) ?? chromeSkill, browserSkill],
  };
}

export function browserProviderFromPrompt(prompt: string): BrowserToolProvider | null {
  let provider: BrowserToolProvider | null = null;
  const pattern = /\$\{(chrome|browser)\}|\$(chrome|browser)(?![A-Za-z0-9_-])/gi;
  for (const match of prompt.matchAll(pattern)) {
    const name = (match[1] ?? match[2] ?? "").toLowerCase();
    provider = name === "chrome" ? "chrome" : "builtIn";
  }
  return provider;
}

export function browserProviderFromRequestParams(params: unknown): BrowserToolProvider | null {
  return browserProviderFromPrompt(promptTextFromRequestParams(params));
}

export function browserToolThreadId(params: unknown): string | null {
  const request = params as (ToolsCallParams & { thread_id?: unknown; threadId?: unknown }) | undefined;
  const id = request?.thread_id ?? request?.threadId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function desktopBrowserToolName(params: unknown): string | undefined {
  const request = params as ToolsCallParams | undefined;
  const name = request?.tool_name ?? request?.name;
  return canonicalBrowserToolName(name);
}

export function canonicalBrowserToolName(name: unknown): string | undefined {
  if (typeof name !== "string") {
    return undefined;
  }
  const chromeAlias = chromeToolAliasByName[name];
  if (chromeAlias) {
    return chromeAlias;
  }
  if (desktopBrowserToolSpecs().some((tool) => tool.name === name)) {
    return name;
  }
  return undefined;
}

export async function callDesktopBrowserTool(
  browser: BrowserManager,
  toolName: string,
  params: unknown,
): Promise<ToolsCallResult> {
  const request = params as ToolsCallParams | undefined;
  const input = request?.arguments ?? request?.input ?? {};
  try {
    const data = toJsonValue(await execute(browser, toolName, input));
    return { text: typeof data === "string" ? data : JSON.stringify(data), data, is_error: false };
  } catch (error) {
    return { text: (error as Error).message, data: null, is_error: true };
  }
}

export async function callChromeBrowserToolAlias(
  request: (method: string, params?: unknown) => Promise<unknown>,
  toolName: string,
  params: unknown,
): Promise<ToolsCallResult> {
  const call = params as ToolsCallParams | undefined;
  const input = call?.arguments ?? call?.input ?? {};
  try {
    const data = toJsonValue(await executeChromeAlias(request, toolName, input));
    return { text: typeof data === "string" ? data : JSON.stringify(data), data, is_error: false };
  } catch (error) {
    return { text: (error as Error).message, data: null, is_error: true };
  }
}

const chromeToolAliasByName: Record<string, string> = {
  chrome_navigate: "browser_navigate",
  chrome_tab_open: "browser_navigate",
  chrome_page_snapshot: "browser_snapshot",
  chrome_snapshot: "browser_snapshot",
  chrome_click: "browser_click",
  chrome_type: "browser_type",
  chrome_keypress: "browser_keypress",
  chrome_scroll: "browser_scroll",
  chrome_eval: "browser_evaluate",
  chrome_evaluate: "browser_evaluate",
  chrome_screenshot: "browser_screenshot",
};

function desktopBrowserToolSpecs(): ToolSpec[] {
  const browserTools: ToolSpec[] = [
    {
      name: "browser_navigate",
      description: "Navigate the built-in Roder Desktop browser to a URL or search query.",
      source: "desktop-browser",
      input_schema: objectSchema({ url: { type: "string", description: "URL or search query." } }, ["url"]),
    },
    {
      name: "browser_snapshot",
      description: "Inspect visible text and interactive controls in the built-in Roder Desktop browser.",
      source: "desktop-browser",
      input_schema: objectSchema({}, []),
    },
    {
      name: "browser_click",
      description:
        "Click a visible element in the built-in Roder Desktop browser by snapshot ref, CSS selector, or text.",
      source: "desktop-browser",
      input_schema: objectSchema(
        { ref: { type: "string" }, selector: { type: "string" }, text: { type: "string" } },
        [],
      ),
    },
    {
      name: "browser_type",
      description: "Type text into an editable element in the built-in Roder Desktop browser.",
      source: "desktop-browser",
      input_schema: objectSchema(
        {
          text: { type: "string" },
          ref: { type: "string" },
          selector: { type: "string" },
          submit: { type: "boolean" },
        },
        ["text"],
      ),
    },
    {
      name: "browser_keypress",
      description: "Send a keyboard key to the built-in Roder Desktop browser.",
      source: "desktop-browser",
      input_schema: objectSchema(
        { key: { type: "string", description: "Key name, such as Enter, Escape, or ArrowDown." } },
        ["key"],
      ),
    },
    {
      name: "browser_scroll",
      description: "Scroll the page or a selected element in the built-in Roder Desktop browser.",
      source: "desktop-browser",
      input_schema: objectSchema({ dx: { type: "number" }, dy: { type: "number" }, selector: { type: "string" } }, []),
    },
    {
      name: "browser_evaluate",
      description: "Evaluate JavaScript in the built-in Roder Desktop browser page.",
      source: "desktop-browser",
      input_schema: objectSchema({ expression: { type: "string" } }, ["expression"]),
    },
    {
      name: "browser_screenshot",
      description: "Capture a screenshot of the built-in Roder Desktop browser and return the local PNG file metadata.",
      source: "desktop-browser",
      input_schema: objectSchema({}, []),
    },
  ];
  return [...browserTools, ...desktopChromeAliasToolSpecs(browserTools)];
}

function desktopChromeAliasToolSpecs(browserTools: ToolSpec[]): ToolSpec[] {
  const browserToolByName = new Map(browserTools.map((tool) => [tool.name, tool]));
  return Object.entries(chromeToolAliasByName).flatMap(([chromeName, browserName]) => {
    const browserTool = browserToolByName.get(browserName);
    if (!browserTool) {
      return [];
    }
    return [
      {
        ...browserTool,
        name: chromeName,
        description: `${browserTool.description} This desktop alias is backed by the built-in browser when $browser is active.`,
        source: "desktop-browser",
      },
    ];
  });
}

async function execute(browser: BrowserManager, toolName: string, input: JsonObject): Promise<unknown> {
  browser.ensureVisible();
  switch (toolName) {
    case "browser_navigate": {
      const snapshot = browser.navigate(requiredString(input, "url"));
      await browser.waitForLoad();
      return snapshot;
    }
    case "browser_snapshot":
      return browser.pageSnapshot();
    case "browser_click":
      return browser.click(optionalTarget(input));
    case "browser_type":
      return browser.type({
        ...optionalTarget(input),
        text: requiredString(input, "text"),
        submit: input.submit === true,
      });
    case "browser_keypress":
      return browser.keypress(requiredString(input, "key"));
    case "browser_scroll":
      return browser.scroll({
        dx: optionalNumber(input, "dx"),
        dy: optionalNumber(input, "dy"),
        selector: optionalString(input, "selector"),
      });
    case "browser_evaluate":
      return browser.evaluate(requiredString(input, "expression"));
    case "browser_screenshot":
      return browser.captureScreenshot();
    default:
      throw new Error(`Unknown desktop browser tool: ${toolName}`);
  }
}

async function executeChromeAlias(
  request: (method: string, params?: unknown) => Promise<unknown>,
  toolName: string,
  input: JsonObject,
): Promise<unknown> {
  switch (toolName) {
    case "browser_navigate":
      return request("chrome/tabs/navigate", { url: requiredString(input, "url") });
    case "browser_snapshot":
      return request("chrome/page/snapshot", { include: ["aria", "forms", "boxes"] });
    case "browser_click":
      return request("chrome/page/action", compactObject({ action: "click", ...optionalTarget(input) }));
    case "browser_type":
      return request(
        "chrome/page/action",
        compactObject({
          action: "type",
          ...optionalTarget(input),
          text: requiredString(input, "text"),
          submit: input.submit === true,
        }),
      );
    case "browser_keypress":
      return request("chrome/page/action", { action: "keypress", key: requiredString(input, "key") });
    case "browser_scroll":
      return request(
        "chrome/page/action",
        compactObject({
          action: "scroll",
          dx: optionalNumber(input, "dx"),
          dy: optionalNumber(input, "dy"),
          selector: optionalString(input, "selector"),
        }),
      );
    case "browser_evaluate":
      return request("chrome/page/action", { action: "eval", expression: requiredString(input, "expression") });
    case "browser_screenshot":
      return request("chrome/page/action", { action: "screenshot" });
    default:
      throw new Error(`Unknown desktop browser tool: ${toolName}`);
  }
}

function promptTextFromRequestParams(params: unknown): string {
  if (!isRecord(params)) {
    return "";
  }
  const pieces: string[] = [];
  for (const key of ["prompt", "initialPrompt", "message"]) {
    if (typeof params[key] === "string") {
      pieces.push(params[key]);
    }
  }
  if (Array.isArray(params.input)) {
    for (const item of params.input) {
      if (isRecord(item) && typeof item.text === "string") {
        pieces.push(item.text);
      }
    }
  }
  return pieces.join("\n");
}

function objectSchema(properties: Record<string, unknown>, required: string[]): unknown {
  return { type: "object", properties, required, additionalProperties: false };
}

function requiredString(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`browser tool argument '${key}' must be a non-empty string`);
  }
  return value;
}

function optionalString(input: JsonObject, key: string): string | undefined {
  return typeof input[key] === "string" ? input[key] : undefined;
}

function optionalNumber(input: JsonObject, key: string): number | undefined {
  return typeof input[key] === "number" ? input[key] : undefined;
}

function optionalTarget(input: JsonObject): { selector?: string; text?: string; ref?: string } {
  return {
    selector: optionalString(input, "selector"),
    text: optionalString(input, "text"),
    ref: optionalString(input, "ref"),
  };
}

function compactObject<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined));
}

function isToolsListResult(value: unknown): value is ToolsListResult {
  return isRecord(value) && (Array.isArray(value.tools) || value.tools === undefined);
}

function isSkillsListResult(value: unknown): value is { skills: unknown[]; diagnostics: unknown[] } {
  return (
    isRecord(value) &&
    Array.isArray(value.skills) &&
    (Array.isArray(value.diagnostics) || value.diagnostics === undefined)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function existingSkill(skills: unknown[], fallback: typeof chromeSkill): unknown | null {
  return skills.find((skill) => isRecord(skill) && skill.name === fallback.name) ?? null;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]));
  }
  return null;
}
