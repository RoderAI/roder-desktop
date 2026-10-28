import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ThreadAccountingSummary } from "../src/components/thread-cost-popover";
import { openRouterPricing, type PricingSnapshot } from "../src/lib/thread-cost";
import { estimateThreadTreeCost } from "../src/lib/thread-cost-tree";

vi.mock("../src/stores/roder-store", () => ({
  useRoderStore: { getState: () => ({ subagentTracesByThread: {} }) },
}));

const pricing: PricingSnapshot = {
  source: "test",
  fetchedAt: "2026-10-24",
  models: [
    {
      id: "test/model",
      name: "Test model",
      pricing: { prompt: "0.001", completion: "0.002", input_cache_read: "0.0001", input_cache_write: "0.0015" },
    },
  ],
};
type CostTree = Parameters<typeof estimateThreadTreeCost>[0];

function recordedEstimate() {
  return estimateThreadTreeCost(
    {
      threads: [
        {
          id: "root",
          title: "This thread",
          rows: [
            {
              group: "test/model",
              promptTokens: 800,
              completionTokens: 100,
              cachedPromptTokens: 100,
              cacheCreationPromptTokens: 50,
            },
          ],
          usage: {
            promptTokens: 900,
            completionTokens: 100,
            totalTokens: 1000,
            cachedPromptTokens: 100,
            cacheCreationPromptTokens: 50,
          },
          usageAvailable: true,
          unattributedTokens: 100,
          source: "analytics",
          depth: 0,
          incomplete: true,
        },
        {
          id: "child",
          title: "Reviewer",
          rows: [{ group: "test/model", promptTokens: 200, completionTokens: 50, cachedPromptTokens: 20 }],
          source: "analytics",
          depth: 1,
          incomplete: false,
        },
        {
          id: "nested",
          title: "Nested task",
          rows: [{ group: "test/model", promptTokens: 100, completionTokens: 50, cachedPromptTokens: 0 }],
          source: "trace",
          depth: 2,
          incomplete: true,
        },
      ],
      incomplete: true,
      warnings: ["Analytics can arrive after turn completion."],
      scannedTurns: 56,
      skippedTurns: 12,
    },
    pricing,
  );
}

function render(overrides: Partial<React.ComponentProps<typeof ThreadAccountingSummary>> = {}) {
  return renderToStaticMarkup(
    React.createElement(ThreadAccountingSummary, {
      threadId: "root",
      estimate: recordedEstimate(),
      status: "ready",
      tab: "thread",
      onTabChange: () => {},
      onRefresh: () => {},
      onScanMore: () => {},
      ...overrides,
    }),
  );
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singleThread(rows: CostTree["threads"][number]["rows"]) {
  return estimateThreadTreeCost(
    {
      threads: [{ id: "root", title: "This thread", rows, source: "analytics", depth: 0, incomplete: false }],
      incomplete: false,
    },
    pricing,
  );
}

test("recorded totals separate this thread from all nested subagent usage", () => {
  const html = render();
  const content = text(html);
  expect(content).toContain("Recorded tokens 1,400");
  expect(content).toContain("This thread 1,000 Subagents (2) 400");
  expect(content).toContain("1,200 input · 200 output");
  expect(content).toContain("Cache read: 120 · Cache write: 50");
  expect(content).toContain("Reviewer");
  expect(content).toContain("Subagent · Depth 2 · Trace only");
  expect(content).toContain("250 recorded tokens");
});

test("unattributed recorded tokens remain visible but are explicitly excluded from model cost", () => {
  const content = text(render({ tab: "models" }));
  expect(content).toContain(
    "100 recorded tokens are not attributed to a model and are excluded from the cost estimate.",
  );
  expect(content).toContain("1,300 attributed tokens");
  expect(content).toContain("$1.42");
  expect(content).toContain("Known priced contributions only. Not a provider invoice.");
});

test("four token categories and dated rates remain available in both breakdown tabs", () => {
  for (const tab of ["thread", "models"]) {
    const content = text(render({ tab }));
    expect(content).toMatch(/Uncached input.*Cache read.*Cache write.*Output/);
    expect(content).toContain("By thread");
    expect(content).toContain("By model");
    expect(content).toContain(`OpenRouter rates ${openRouterPricing.fetchedAt.slice(0, 10)}`);
    expect(content).toContain("Partial estimate");
    expect(content).not.toMatch(/\$[\d,.]+\+/);
  }
});

test("trace-only accounting explains historical gaps without claiming the fixed upstream bug still exists", () => {
  const content = text(render());
  expect(content).toContain("Trace-only agent usage can be incomplete, especially in historical records.");
  expect(content).toContain("Recorded totals update after turns finish, not live while a turn runs.");
  expect(content).toContain("Historical failures and archived agents may have incomplete usage.");
  expect(content).not.toContain("some task agents report only their latest inference step");
  expect(content).toContain("Accounting notes (1)");
  expect(content).toContain("Analytics can arrive after turn completion.");
});

test("a missing cache-write rate retains known costs without treating unpriced writes as free", () => {
  const estimate = estimateThreadTreeCost(
    {
      threads: [
        {
          id: "root",
          title: "This thread",
          source: "analytics",
          incomplete: false,
          rows: [
            {
              group: "test/model",
              promptTokens: 100,
              completionTokens: 10,
              cachedPromptTokens: 20,
              cacheCreationPromptTokens: 30,
            },
          ],
        },
      ],
      incomplete: false,
    },
    {
      ...pricing,
      models: [
        {
          id: "test/model",
          name: "Test model",
          pricing: { prompt: "0.001", completion: "0.002", input_cache_read: "0.0001" },
        },
      ],
    },
  );
  for (const tab of ["thread", "models"]) {
    const content = text(render({ estimate, tab }));
    expect(content).toContain("$0.07 Partial estimate");
    expect(content).toContain("Cache write 30 tokens · Cost unavailable Partial estimate");
    expect(content).toContain("Some model or cache-write rates are unavailable.");
  }
});

test("partially priced category totals identify their known subtotal rather than a complete cost", () => {
  const estimate = singleThread([
    { group: "test/model", promptTokens: 50, completionTokens: 10, cachedPromptTokens: 0 },
    { group: "unknown/model", promptTokens: 100, completionTokens: 10, cachedPromptTokens: 0 },
  ]);
  const content = text(render({ estimate }));
  expect(content).toContain("Uncached input 150 tokens · $0.05 known subtotal Partial estimate");
  expect(content).toContain("Output 20 tokens · $0.02 known subtotal Partial estimate");
  expect(content).toContain("$0.07 Partial estimate");
});

test("unpriced models still show recorded tokens without inventing a zero total", () => {
  const estimate = singleThread([
    { group: "unknown/model", promptTokens: 150, completionTokens: 20, cachedPromptTokens: 0 },
  ]);
  const content = text(render({ estimate, tab: "models" }));
  expect(content).toContain("Recorded tokens 170");
  expect(content).toContain("Unavailable Partial estimate");
  expect(content).toContain("170 attributed tokens");
  expect(content).toContain("Uncached input 150 tokens · Cost unavailable");
});

test("recorded metadata without model attribution keeps tokens and unavailable dollars distinct", () => {
  const estimate = estimateThreadTreeCost({
    threads: [
      {
        id: "root",
        title: "This thread",
        rows: [],
        source: "unavailable",
        usage: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          cachedPromptTokens: 0,
          cacheCreationPromptTokens: 0,
        },
        usageAvailable: true,
        unattributedTokens: 120,
        incomplete: true,
      },
    ],
    incomplete: true,
  });
  const content = text(render({ estimate }));
  expect(content).toContain("Recorded tokens 120");
  expect(content).toContain("This thread 120");
  expect(content).toContain("120 recorded tokens are not attributed to a model");
  expect(content).toContain("Unavailable Partial estimate");
  expect(content).toContain("No model attribution");
});

test("unavailable accounting does not masquerade as a recorded zero", () => {
  const estimate = estimateThreadTreeCost({
    threads: [
      { id: "root", title: "This thread", rows: [], source: "unavailable", usageAvailable: false, incomplete: true },
    ],
    incomplete: true,
  });
  const content = text(render({ estimate }));
  expect(content).toContain("Recorded tokens No recorded usage");
  expect(content).toContain("This thread Unavailable");
  expect(content).toContain("No recorded token usage");
  expect(content).not.toContain("0 recorded tokens");
  expect(content).not.toContain("0 input");
});

test("a genuinely recorded zero remains distinct from missing usage", () => {
  const estimate = singleThread([{ group: "test/model", promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0 }]);
  const content = text(render({ estimate }));
  expect(content).toContain("Recorded tokens 0");
  expect(content).toContain("This thread 0");
  expect(content).toContain("$0.00 Estimated API cost");
  expect(content).not.toContain("No recorded usage");
});

test("load errors put an accessible refresh action beside the error", () => {
  const html = render({ status: "error" });
  expect(html).toMatch(/role="alert">Usage could not be loaded\.<\/p><button/);
  expect(html.match(/>Refresh<\/button>/g)).toHaveLength(1);
  expect(html).not.toContain("Reopen to retry");
  expect(text(html)).toContain("Recorded tokens Unavailable");
});

test("scan controls expose skipped history and disable further scans at the maximum budget", () => {
  const limited = render({ scanLimited: true });
  expect(text(limited)).toContain("Scan more history");
  expect(text(limited)).toContain("Scanned 56 turns for task-agent history. 12 turns not scanned.");
  expect(limited).not.toMatch(/<button[^>]*disabled=""[^>]*>Scan more history/);
  const maximum = render({ scanLimited: true, scanAtMaximum: true });
  expect(maximum).toMatch(/<button[^>]*disabled=""[^>]*>Scan more history<\/button>/);
  expect(text(maximum)).toContain("Maximum scan budget reached.");
  expect(render()).not.toContain("Scan more history");
});

test("refreshing disables both retry and deeper-scan actions", () => {
  const html = render({ refreshing: true, scanLimited: true });
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Refreshing\.\.\.<\/button>/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Scan more history<\/button>/);
});

test("loading an empty snapshot shows loading rather than an authoritative token zero", () => {
  const content = text(
    render({ status: "loading", estimate: estimateThreadTreeCost({ threads: [], incomplete: false }) }),
  );
  expect(content).toContain("Recorded tokens Loading...");
  expect(content).not.toContain("0 input");
  expect(content).not.toContain("Recorded tokens 0");
});
