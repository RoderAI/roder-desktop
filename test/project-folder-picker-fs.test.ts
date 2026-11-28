import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  listProjectPickerDirectory,
  ProjectPickerSearchRegistry,
  searchProjectPickerFolders,
  shouldSkipDirectoryInSearch,
} from "../electron/main/project-picker";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "project-picker-"));
  const dirs = [
    "w/roder/.git",
    "w/roder/crates/roder-core",
    "w/roder-desktop/.git",
    "w/vex-intsearch/vex-roder",
    "w/notes",
    "w/.hidden-roder",
    "w/app/node_modules/roder-pkg",
    "Library/roder-cache",
    "a/b/c/d/e/f/roder-too-deep",
  ];
  for (const dir of dirs) {
    await mkdir(join(root, dir), { recursive: true });
  }
  await writeFile(join(root, "w", "roder-file.txt"), "not a folder");
  await symlink(join(root, "w", "notes"), join(root, "w", "notes-link"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("lists only folders, sorted, with git detection and followed symlinks", async () => {
  const listing = await listProjectPickerDirectory(join(root, "w"));
  expect(listing.path).toBe(join(root, "w"));
  expect(listing.entries.map((entry) => [entry.name, entry.isGitRepo])).toEqual([
    [".hidden-roder", false],
    ["app", false],
    ["notes", false],
    ["notes-link", false],
    ["roder", true],
    ["roder-desktop", true],
    ["vex-intsearch", false],
  ]);
  expect(listing.truncated).toBe(false);
});

test("rejects relative paths and surfaces missing folders", async () => {
  await expect(listProjectPickerDirectory("w")).rejects.toThrow("path must be absolute");
  await expect(listProjectPickerDirectory(join(root, "missing"))).rejects.toThrow(/ENOENT/);
});

test("deep search finds folder-name matches and skips hidden and heavy directories", async () => {
  const result = await searchProjectPickerFolders({ root, query: "RODER" });
  const paths = result.matches.map((match) => match.path.slice(root.length).replaceAll("\\", "/")).sort();
  expect(paths).toEqual(["/w/roder", "/w/roder-desktop", "/w/roder/crates/roder-core", "/w/vex-intsearch/vex-roder"]);
  expect(result.matches.find((match) => match.name === "roder")?.isGitRepo).toBe(true);
  expect(result.canceled).toBe(false);
});

test("deep search never offers skipped folders as matches", async () => {
  for (const query of ["node_modules", "Library"]) {
    const result = await searchProjectPickerFolders({ root, query });
    expect(result.matches).toEqual([]);
  }
});

test("deep search reports truncation when it stops queueing folders", async () => {
  const result = await searchProjectPickerFolders({ root: join(root, "w"), query: "roder" }, undefined, {
    maxVisitedDirectories: 1,
  });
  expect(result.matches.map((match) => match.name).sort()).toEqual(["roder", "roder-desktop"]);
  expect(result.truncated).toBe(true);
});

test("listing stops at its folder limit", async () => {
  const listing = await listProjectPickerDirectory(join(root, "w"), 2);
  expect(listing.entries).toHaveLength(2);
  expect(listing.truncated).toBe(true);
});

test("a canceled search result is not changed by matches still queued from the worker", async () => {
  const controller = new AbortController();
  const pending = searchProjectPickerFolders({ root, query: "roder" }, controller.signal);
  // Block this thread so the worker posts its matches before the cancel is handled.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  controller.abort();
  const result = await pending;
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(result.canceled).toBe(true);
  expect(result.matches).toEqual([]);
});

test("deep search is bounded by depth and result count", async () => {
  const shallow = await searchProjectPickerFolders({ root, query: "roder", maxDepth: 2 });
  expect(shallow.matches.map((match) => match.name).sort()).toEqual(["roder", "roder-desktop"]);

  const limited = await searchProjectPickerFolders({ root, query: "roder", limit: 1 });
  expect(limited.matches).toHaveLength(1);
  expect(limited.truncated).toBe(true);

  const deep = await searchProjectPickerFolders({ root, query: "roder-too-deep", maxDepth: 10 });
  expect(deep.matches).toHaveLength(1);
});

test("deep search stops when aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await searchProjectPickerFolders({ root, query: "roder" }, controller.signal);
  expect(result.canceled).toBe(true);
  expect(result.matches).toEqual([]);
});

test("a new search from the same renderer cancels the previous one", async () => {
  const registry = new ProjectPickerSearchRegistry(root);
  const first = registry.search(1, { query: "roder" });
  const second = registry.search(1, { query: "notes" });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  expect(firstResult.canceled).toBe(true);
  expect(secondResult.canceled).toBe(false);
  expect(secondResult.matches.map((match) => match.name)).toEqual(["notes"]);
});

test("renderer requests cannot change the search root or widen its bounds", async () => {
  const registry = new ProjectPickerSearchRegistry(join(root, "a"));
  const request = { query: "roder", root, maxDepth: 20, limit: 500 };
  const result = await registry.search(1, request);
  expect(result.root).toBe(join(root, "a"));
  // "roder-too-deep" sits below the five-level bound, and nothing outside "a" is searched.
  expect(result.matches).toEqual([]);
});

test("skips package-like and heavy directory names", () => {
  expect(shouldSkipDirectoryInSearch("node_modules")).toBe(true);
  expect(shouldSkipDirectoryInSearch("Library")).toBe(true);
  expect(shouldSkipDirectoryInSearch(".git")).toBe(true);
  expect(shouldSkipDirectoryInSearch("Safari.app")).toBe(true);
  expect(shouldSkipDirectoryInSearch("roder")).toBe(false);
});

test("deep search respects its time budget", async () => {
  const started = Date.now();
  const result = await searchProjectPickerFolders({ root, query: "roder" }, undefined, { timeBudgetMs: 0 });
  expect(result.truncated).toBe(true);
  expect(Date.now() - started).toBeLessThan(1_000);
});
