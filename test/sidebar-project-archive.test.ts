import { afterEach, expect, test, vi } from "vitest";
import { readArchivedSidebarProjects, setSidebarProjectArchived } from "../src/lib/sidebar-project-archive";

afterEach(() => vi.unstubAllGlobals());

function storage(initial = "[]") {
  const values = new Map([["sidebar-archived-projects", initial]]);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  return values;
}

test("archiving persists folder identity and restoring preserves other archives", () => {
  const values = storage();
  const archived = setSidebarProjectArchived([], "/workspace/project", true);
  expect(readArchivedSidebarProjects()).toEqual(["/workspace/project"]);
  expect(setSidebarProjectArchived(archived, "/workspace/project", true)).toEqual(archived);
  const both = setSidebarProjectArchived(archived, "/other/project", true);
  expect(setSidebarProjectArchived(both, "/workspace/project", false)).toEqual(["/other/project"]);
  expect(JSON.parse(values.get("sidebar-archived-projects")!)).toEqual(["/other/project"]);
  expect(archived).toEqual(["/workspace/project"]);
});

test.each(["{bad json", "null", "{}", '["/project", 1]'])("invalid archive storage safely falls back: %s", (saved) => {
  storage(saved);
  expect(readArchivedSidebarProjects()).toEqual([]);
});

test("archive operations work in memory when storage is unavailable", () => {
  vi.stubGlobal("window", {
    get localStorage() {
      throw new Error("Storage unavailable");
    },
  });
  expect(readArchivedSidebarProjects()).toEqual([]);
  expect(setSidebarProjectArchived([], "/project", true)).toEqual(["/project"]);
  expect(setSidebarProjectArchived(["/project"], "/project", false)).toEqual([]);
});
