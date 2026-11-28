import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  buildProjectPickerRows,
  deviceDisplayName,
  displayPath,
  filterDeepFolders,
  filterLocalFolders,
  highlightSegments,
  initialProjectPickerPath,
  matchFolderName,
  moveSelectionIndex,
  parentPath,
  projectPickerBreadcrumbs,
  projectPickerKeyAction,
  projectPickerLocalRowLimit,
  resolveSelectedIndex,
  type ProjectPickerKeyInput,
  type ProjectPickerRow,
} from "../src/lib/project-picker";
import type { ProjectPickerEntry } from "../src/types/project-picker";

const home = "/Users/pz";

function entry(path: string, isGitRepo = false): ProjectPickerEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, isGitRepo };
}

const wEntries = [
  entry("/Users/pz/w/roder-desktop", true),
  entry("/Users/pz/w/vex-roder"),
  entry("/Users/pz/w/roder", true),
  entry("/Users/pz/w/notes"),
  entry("/Users/pz/w/.cache"),
  entry("/Users/pz/w/Producer"),
];

describe("matching and filtering", () => {
  test("ranks exact, prefix, word-boundary, then substring matches", () => {
    expect(matchFolderName("roder", "Roder")).toEqual({ start: 0, end: 5, rank: 0 });
    expect(matchFolderName("roder-desktop", "roder")).toEqual({ start: 0, end: 5, rank: 1 });
    expect(matchFolderName("vex-roder", "roder")).toEqual({ start: 4, end: 9, rank: 2 });
    expect(matchFolderName("Producer", "od")).toEqual({ start: 2, end: 4, rank: 3 });
    expect(matchFolderName("notes", "roder")).toBeNull();
    expect(matchFolderName("notes", "  ")).toBeNull();
  });

  test("prefers a word-boundary occurrence over an earlier mid-word one", () => {
    expect(matchFolderName("prod-dev", "d")).toEqual({ start: 5, end: 6, rank: 2 });
  });

  test("filters the current directory by query, best matches first", () => {
    const { rows } = filterLocalFolders(wEntries, "roder");
    expect(rows.map((row) => row.entry.name)).toEqual(["roder", "roder-desktop", "vex-roder"]);
    expect(rows[2]?.match).toEqual({ start: 4, end: 9, rank: 2 });
  });

  test("lists every visible folder in order with an empty query and hides dot folders", () => {
    const { rows } = filterLocalFolders(wEntries, "");
    expect(rows.map((row) => row.entry.name)).toEqual(["roder-desktop", "vex-roder", "roder", "notes", "Producer"]);
    expect(rows.every((row) => row.match === null)).toBe(true);
  });

  test("shows hidden folders when the query starts with a dot", () => {
    const { rows } = filterLocalFolders(wEntries, ".ca");
    expect(rows.map((row) => row.entry.name)).toEqual([".cache"]);
  });

  test("caps rendered local rows but reports the total", () => {
    const many = Array.from({ length: projectPickerLocalRowLimit + 25 }, (_, index) => entry(`/tmp/dir-${index}`));
    const result = filterLocalFolders(many, "");
    expect(result.rows).toHaveLength(projectPickerLocalRowLimit);
    expect(result.total).toBe(projectPickerLocalRowLimit + 25);
  });

  test("deep matches exclude direct children of the current folder and show a ~ parent path", () => {
    const deep = [
      entry("/Users/pz/w/roder"),
      entry("/Users/pz/w/vex-intsearch/vex-roder"),
      entry("/Users/pz/w/a/b/roder"),
      entry("/Users/pz/w/vex-intsearch/vex-roder"),
    ];
    const rows = filterDeepFolders(deep, "roder", "/Users/pz/w", home);
    expect(rows.map((row) => [row.entry.path, row.parentLabel])).toEqual([
      ["/Users/pz/w/a/b/roder", "~/w/a/b"],
      ["/Users/pz/w/vex-intsearch/vex-roder", "~/w/vex-intsearch"],
    ]);
  });

  test("deep matches from an earlier query narrow instantly for a longer query", () => {
    const deep = [entry("/Users/pz/x/roder"), entry("/Users/pz/x/rollup")];
    expect(filterDeepFolders(deep, "rod", "/Users/pz/w", home).map((row) => row.entry.name)).toEqual(["roder"]);
    expect(filterDeepFolders(deep, "r", "/Users/pz/w", home)).toEqual([]);
  });

  test("builds one flat row list with local rows before deep rows", () => {
    const rows = buildProjectPickerRows({
      entries: wEntries,
      deepMatches: [entry("/Users/pz/w/vex-intsearch/vex-roder")],
      query: "roder",
      currentPath: "/Users/pz/w",
      homeDir: home,
    });
    expect(rows.all.map((row) => `${row.section}:${row.entry.name}`)).toEqual([
      "local:roder",
      "local:roder-desktop",
      "local:vex-roder",
      "deep:vex-roder",
    ]);
  });

  test("splits names into highlighted segments", () => {
    expect(highlightSegments("vex-roder", { start: 4, end: 9 })).toEqual([
      { text: "vex-", match: false },
      { text: "roder", match: true },
    ]);
    expect(highlightSegments("roder", null)).toEqual([{ text: "roder", match: false }]);
  });
});

describe("selection and keyboard navigation", () => {
  const rows = buildProjectPickerRows({
    entries: wEntries,
    deepMatches: [],
    query: "roder",
    currentPath: "/Users/pz/w",
    homeDir: home,
  }).all;

  test("selects the first row while searching and nothing (current folder) with an empty query", () => {
    expect(resolveSelectedIndex(rows, null, "roder")).toBe(0);
    expect(resolveSelectedIndex(rows, null, "")).toBe(-1);
    expect(resolveSelectedIndex([], null, "roder")).toBe(-1);
  });

  test("keeps the selection by key when rows reorder and falls back when it disappears", () => {
    expect(resolveSelectedIndex(rows, "local:/Users/pz/w/vex-roder", "roder")).toBe(2);
    expect(resolveSelectedIndex(rows, "local:/gone", "roder")).toBe(0);
  });

  test("moves selection within bounds", () => {
    expect(moveSelectionIndex(0, 1, 3)).toBe(1);
    expect(moveSelectionIndex(2, 1, 3)).toBe(2);
    expect(moveSelectionIndex(0, -1, 3)).toBe(0);
    expect(moveSelectionIndex(-1, 1, 3)).toBe(0);
    expect(moveSelectionIndex(-1, -1, 3)).toBe(2);
    expect(moveSelectionIndex(1, 1, 0)).toBe(-1);
  });

  test("Up from the first row returns to the current folder when the query is empty", () => {
    expect(moveSelectionIndex(0, -1, 3, true)).toBe(-1);
    expect(moveSelectionIndex(-1, -1, 3, true)).toBe(-1);
  });

  function key(overrides: Partial<ProjectPickerKeyInput>): ProjectPickerKeyInput {
    return {
      key: "a",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      caretAtStart: false,
      queryEmpty: false,
      platform: "darwin",
      ...overrides,
    };
  }

  test("maps keys to picker actions", () => {
    expect(projectPickerKeyAction(key({ key: "ArrowDown" }))).toBe("down");
    expect(projectPickerKeyAction(key({ key: "ArrowUp" }))).toBe("up");
    expect(projectPickerKeyAction(key({ key: "Enter" }))).toBe("open");
    expect(projectPickerKeyAction(key({ key: "Enter", metaKey: true }))).toBe("add");
    expect(projectPickerKeyAction(key({ key: "Escape" }))).toBe("close");
    expect(projectPickerKeyAction(key({ key: "a" }))).toBeNull();
  });

  test("uses Control+Enter to add off macOS", () => {
    expect(projectPickerKeyAction(key({ key: "Enter", ctrlKey: true, platform: "linux" }))).toBe("add");
    expect(projectPickerKeyAction(key({ key: "Enter", metaKey: true, platform: "linux" }))).toBeNull();
  });

  test("Left goes back only when the caret is at the start, so it still edits the query", () => {
    expect(projectPickerKeyAction(key({ key: "ArrowLeft", caretAtStart: true }))).toBe("back");
    expect(projectPickerKeyAction(key({ key: "ArrowLeft", caretAtStart: false }))).toBeNull();
    expect(projectPickerKeyAction(key({ key: "ArrowLeft", caretAtStart: true, shiftKey: true }))).toBeNull();
  });

  test("Backspace goes back only with an empty query", () => {
    expect(projectPickerKeyAction(key({ key: "Backspace", caretAtStart: true, queryEmpty: true }))).toBe("back");
    expect(projectPickerKeyAction(key({ key: "Backspace", caretAtStart: true, queryEmpty: false }))).toBeNull();
  });

  test("ignores keys while an IME composition is active", () => {
    expect(projectPickerKeyAction(key({ key: "Enter", isComposing: true }))).toBeNull();
  });
});

describe("paths and breadcrumbs", () => {
  test("computes parents up to the filesystem root", () => {
    expect(parentPath("/Users/pz/w")).toBe("/Users/pz");
    expect(parentPath("/Users/pz/w/")).toBe("/Users/pz");
    expect(parentPath("/Users")).toBe("/");
    expect(parentPath("/")).toBeNull();
    expect(parentPath("C:\\Users\\pz")).toBe("C:\\Users");
    expect(parentPath("C:\\Users")).toBe("C:\\");
    expect(parentPath("C:\\")).toBeNull();
  });

  test("abbreviates paths under home with ~", () => {
    expect(displayPath("/Users/pz/w/vex-intsearch", home)).toBe("~/w/vex-intsearch");
    expect(displayPath("/Users/pz", home)).toBe("~");
    expect(displayPath("/Users/pzz/w", home)).toBe("/Users/pzz/w");
    expect(displayPath("/opt/src", home)).toBe("/opt/src");
  });

  test("breadcrumbs show device, Home, then each folder under home", () => {
    expect(projectPickerBreadcrumbs("/Users/pz/w", home, "Mdizzy")).toEqual([
      { key: "device", label: "Mdizzy", path: "/", kind: "device" },
      { key: "home", label: "Home", path: "/Users/pz", kind: "home" },
      { key: "/Users/pz/w", label: "w", path: "/Users/pz/w", kind: "directory" },
    ]);
  });

  test("breadcrumbs outside home start at the device root", () => {
    expect(projectPickerBreadcrumbs("/opt/src", home, "Mdizzy").map((crumb) => [crumb.label, crumb.path])).toEqual([
      ["Mdizzy", "/"],
      ["opt", "/opt"],
      ["src", "/opt/src"],
    ]);
    expect(projectPickerBreadcrumbs("/", home, "Mdizzy")).toHaveLength(1);
  });

  test("opens next to the active project when it lives under home", () => {
    expect(initialProjectPickerPath("/Users/pz/w/roder", home)).toBe("/Users/pz/w");
    expect(initialProjectPickerPath("/Users/pz", home)).toBe("/Users/pz");
    expect(initialProjectPickerPath("/opt/src", home)).toBe("/Users/pz");
    expect(initialProjectPickerPath(undefined, home)).toBe("/Users/pz");
  });

  test("derives a readable device name from the host name", () => {
    expect(deviceDisplayName("Mdizzy.local")).toBe("Mdizzy");
    expect(deviceDisplayName("")).toBe("This computer");
  });
});

async function renderRow(props: { row: ProjectPickerRow; selected: boolean }): Promise<string> {
  // The component module pulls in roder-ipc, which binds to the preload bridge at import time.
  (globalThis as { window?: unknown }).window = {
    roderDesktop: {
      request: async () => ({}),
      onNotification: () => () => undefined,
      onStderr: () => () => undefined,
    },
  };
  const { ProjectPickerRowItem } = await import("../src/components/project-picker-dialog");
  return renderToStaticMarkup(
    React.createElement(ProjectPickerRowItem, { id: "row-0", index: 0, onHover() {}, onOpen() {}, ...props }),
  );
}

describe("row rendering", () => {
  test("highlights the match and marks git repositories", async () => {
    const [row] = filterDeepFolders([entry("/Users/pz/w/vex-intsearch/vex-roder", true)], "roder", "/Users/pz/w", home);
    const html = await renderRow({ row: row!, selected: true });
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toMatch(/<mark[^>]*data-slot="project-picker-match"[^>]*>roder<\/mark>/);
    expect(html).toContain("vex-");
    expect(html).toContain("~/w/vex-intsearch");
    expect(html).toContain('data-slot="project-picker-git"');
  });

  test("omits the git glyph for plain folders", async () => {
    const { rows } = filterLocalFolders([entry("/Users/pz/w/notes")], "");
    const html = await renderRow({ row: rows[0]!, selected: false });
    expect(html).not.toContain("project-picker-git");
    expect(html).not.toContain("<mark");
  });
});
