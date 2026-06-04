import { expect, test } from "vitest";
import {
  reviewActiveFilePath,
  reviewBranchAreaFiles,
  reviewChangedFilesHeadline,
  reviewChangedFilesTotals,
  reviewDiffPathsToLoad,
  reviewFileTreeDefaultVisible,
  reviewFileTreeStatusLabel,
  reviewFileTreeToggleLabel,
  reviewFileTreeWidth,
  reviewLatestSelectedFilePath,
} from "../src/lib/review-panel-ui";

test("reviewChangedFilesHeadline describes the number of changed files", () => {
  expect(reviewChangedFilesHeadline(0)).toBe("0 Files Changed");
  expect(reviewChangedFilesHeadline(1)).toBe("1 File Changed");
  expect(reviewChangedFilesHeadline(2)).toBe("2 Files Changed");
});

test("reviewChangedFilesTotals sums changed file stats", () => {
  expect(
    reviewChangedFilesTotals([
      { additions: 3, deletions: 1 },
      { additions: 5, deletions: 0 },
      { additions: 0, deletions: 2 },
    ]),
  ).toEqual({ additions: 8, deletions: 3 });
});

test("reviewBranchAreaFiles filters branch files by staged and unstaged areas", () => {
  const files = [
    { path: "committed.ts", status: "modified" as const, areas: ["committed" as const] },
    { path: "staged.ts", status: "modified" as const, areas: ["staged" as const] },
    { path: "mixed.ts", status: "modified" as const, areas: ["staged" as const, "unstaged" as const] },
    { path: "dirty.ts", status: "modified" as const, areas: ["unstaged" as const] },
    { path: "new.ts", status: "untracked" as const, areas: ["untracked" as const] },
  ];

  expect(reviewBranchAreaFiles(files, "all").map((file) => file.path)).toEqual([
    "committed.ts",
    "staged.ts",
    "mixed.ts",
    "dirty.ts",
    "new.ts",
  ]);
  expect(reviewBranchAreaFiles(files, "staged").map((file) => file.path)).toEqual(["staged.ts", "mixed.ts"]);
  expect(reviewBranchAreaFiles(files, "unstaged").map((file) => file.path)).toEqual(["mixed.ts", "dirty.ts", "new.ts"]);
});

test("reviewFileTreeToggleLabel describes the action for the current file tree state", () => {
  expect(reviewFileTreeToggleLabel(true)).toBe("Hide changed files");
  expect(reviewFileTreeToggleLabel(false)).toBe("Show changed files");
});

test("review file tree starts hidden by default", () => {
  expect(reviewFileTreeDefaultVisible).toBe(false);
});

test("reviewFileTreeWidth clamps the resizable file sidebar to practical bounds", () => {
  expect(reviewFileTreeWidth(120)).toBe(180);
  expect(reviewFileTreeWidth(280)).toBe(280);
  expect(reviewFileTreeWidth(520)).toBe(360);
});

test("reviewFileTreeStatusLabel hides implicit modified state and labels exceptional states", () => {
  expect(reviewFileTreeStatusLabel("modified")).toBeNull();
  expect(reviewFileTreeStatusLabel("untracked")).toBe("new");
  expect(reviewFileTreeStatusLabel("added")).toBe("added");
  expect(reviewFileTreeStatusLabel("deleted")).toBe("deleted");
  expect(reviewFileTreeStatusLabel("renamed")).toBe("renamed");
});

test("reviewLatestSelectedFilePath picks the newest selected file and ignores directories", () => {
  expect(
    reviewLatestSelectedFilePath(["src/alpha.ts", "src/components", "src/beta.ts"], ["src/alpha.ts", "src/beta.ts"]),
  ).toBe("src/beta.ts");
  expect(reviewLatestSelectedFilePath(["src/components"], ["src/alpha.ts"], "src/alpha.ts")).toBe("src/alpha.ts");
  expect(reviewLatestSelectedFilePath(["src/components"], ["src/alpha.ts"], "src/missing.ts")).toBe("");
});

test("reviewActiveFilePath selects the file at the reading anchor", () => {
  expect(
    reviewActiveFilePath(
      [
        { path: "src/alpha.ts", top: -160, bottom: 48 },
        { path: "src/beta.ts", top: 48, bottom: 360 },
        { path: "src/gamma.ts", top: 360, bottom: 720 },
      ],
      { top: 0, bottom: 400 },
      "src/alpha.ts",
    ),
  ).toBe("src/beta.ts");
});

test("reviewActiveFilePath falls back to the most visible file", () => {
  expect(
    reviewActiveFilePath(
      [
        { path: "src/alpha.ts", top: -300, bottom: -20 },
        { path: "src/beta.ts", top: 340, bottom: 460 },
        { path: "src/gamma.ts", top: 460, bottom: 760 },
      ],
      { top: 0, bottom: 400 },
      "src/alpha.ts",
    ),
  ).toBe("src/beta.ts");
});

test("reviewDiffPathsToLoad prioritizes selected and nearby unloaded diffs", () => {
  expect(
    reviewDiffPathsToLoad({
      files: ["src/alpha.ts", "src/beta.ts", "src/gamma.ts", "src/delta.ts"],
      selectedPath: "src/gamma.ts",
      nearbyPaths: ["src/alpha.ts", "src/beta.ts", "src/delta.ts"],
      diffStatesByPath: {
        "src/alpha.ts": { status: "idle" },
        "src/beta.ts": { status: "loading" },
        "src/delta.ts": { status: "idle" },
      },
    }),
  ).toEqual(["src/gamma.ts", "src/alpha.ts", "src/delta.ts"]);
});
