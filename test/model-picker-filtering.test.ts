import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ModelPicker } from "../src/components/composer-controls";
import type { ProviderDescriptor } from "../src/types/roder";
import type { ModelPickerGroup, ModelPickerItem } from "../src/lib/model-picker";

const input = vi.hoisted(() => ({
  query: "",
  providers: [] as ProviderDescriptor[],
  items: [] as ModelPickerGroup[],
  choose: null as ((item: ModelPickerItem) => void) | null,
  navigate:
    vi.fn<
      (options: {
        to: string;
        params: { section: string };
        search: (previous: Record<string, unknown>) => Record<string, unknown>;
      }) => void
    >(),
  selectModel: vi.fn<(model: string, provider?: string) => void>(),
}));
vi.mock("../src/stores/roder-store", () => ({
  useRoderStore: (selector: (state: { providers: ProviderDescriptor[] }) => unknown) =>
    selector({ providers: input.providers }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => input.navigate,
}));
vi.mock("@base-ui/react/combobox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@base-ui/react/combobox")>();
  return {
    ...actual,
    Combobox: {
      ...actual.Combobox,
      Root: (props: React.ComponentProps<typeof actual.Combobox.Root>) => {
        input.items = props.items as ModelPickerGroup[];
        input.choose = props.onValueChange as (item: ModelPickerItem) => void;
        return React.createElement(actual.Combobox.Root, { ...props, open: true, inputValue: input.query });
      },
      Portal: ({ children }: { children: React.ReactNode }) => children,
      Positioner: ({ children }: { children: React.ReactNode }) => children,
      Popup: ({ children }: { children: React.ReactNode }) => children,
    },
  };
});

function renderPicker(
  query: string,
  extraProviders: ProviderDescriptor[] = [],
  selection = { id: "mock", provider: "local" },
) {
  input.query = query;
  input.providers = [
    { id: "local", name: "Local", authType: "local" },
    { id: "openai", name: "OpenAI", authenticated: true, authType: "api_key" },
    { id: "anthropic", name: "Anthropic", authenticated: true, authType: "api_key" },
    ...extraProviders,
  ];
  return renderToStaticMarkup(
    React.createElement(ModelPicker, {
      models: [
        { id: "mock", name: "Mock", modelProvider: "local" },
        { id: "sol", name: "GPT-6.1-Sol", modelProvider: "openai" },
        { id: "claude", name: "Claude Fable", modelProvider: "anthropic" },
      ],
      routingOptions: [
        { id: "coding", label: "Auto coding", routerId: "local", baseline: { provider: "openai", model: "sol" } },
      ],
      selectedModel: selection.id,
      selectedModelProvider: selection.provider,
      selectedSelectionMode: { type: "manual", provider: selection.provider, model: selection.id },
      selectedReasoning: "",
      onChange: input.selectModel,
      onAutoChange: () => {},
      onReasoningChange: () => {},
    }),
  );
}

test("shared model picker renders only matching options from Base UI's filtered provider groups", () => {
  const html = renderPicker("GPT-6.1-Sol");
  expect(html.match(/role="option"/g)).toHaveLength(1);
  expect(html).toContain("GPT-6.1-Sol");
  expect(html).not.toContain("Claude Fable");
  expect(html).not.toContain("Auto coding");
});

test("shared search includes unconfigured catalog models as bottom provider setup actions", () => {
  const html = renderPicker("GPT-6.1-Sol", [
    {
      id: "openrouter",
      name: "OpenRouter",
      authType: "api_key",
      authenticated: false,
      models: [{ id: "sol", name: "GPT-6.1-Sol" }],
    },
  ]);
  expect(html.match(/role="option"/g)).toHaveLength(2);
  expect(html).toContain("Set up provider");
  expect(html).toContain("Set up OpenRouter");
  expect(html.indexOf("OpenAI")).toBeLessThan(html.indexOf("Set up provider"));
});

test("shared model picker searches provider names and Auto routing, and empties unmatched groups", () => {
  expect(renderPicker("anthropic").match(/role="option"/g)).toHaveLength(1);
  const auto = renderPicker("auto");
  expect(auto.match(/role="option"/g)).toHaveLength(1);
  expect(auto).toContain("Auto coding");
  expect(renderPicker("no-such-model")).not.toContain('role="option"');
  expect(renderPicker("").match(/role="option"/g)).toHaveLength(4);
});

test("a setup row opens the exact provider Settings without selecting its model and retains panel search state", () => {
  input.navigate.mockClear();
  input.selectModel.mockClear();
  renderPicker("sol", [
    {
      id: "openrouter",
      name: "OpenRouter",
      authType: "api_key",
      authenticated: false,
      models: [{ id: "sol", name: "GPT-6.1-Sol" }],
    },
  ]);
  const setup = input.items.flatMap((group) => group.items).find((item) => item.type === "setup")!;
  input.choose!(setup);
  expect(input.selectModel).not.toHaveBeenCalled();
  const target = input.navigate.mock.calls[0][0];
  expect(target.to).toBe("/settings/$section");
  expect(target.params).toEqual({ section: "providers" });
  expect(target.search({ panelOpen: true, panelTabs: ["files"] })).toEqual({
    panelOpen: true,
    panelTabs: ["files"],
    setupProvider: "openrouter",
  });
});

test("an unavailable current model remains displayed instead of silently switching to an available model", () => {
  input.selectModel.mockClear();
  const html = renderPicker(
    "no-such-model",
    [
      {
        id: "openrouter",
        name: "OpenRouter",
        authType: "api_key",
        authenticated: false,
        models: [{ id: "sol", name: "Unavailable current model" }],
      },
    ],
    { id: "sol", provider: "openrouter" },
  );
  expect(html).toContain("Unavailable current model");
  expect(input.selectModel).not.toHaveBeenCalled();
});
