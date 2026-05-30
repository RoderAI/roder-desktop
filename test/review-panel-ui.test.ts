import { expect, test } from "vitest";
import {
  reviewActiveFilePath,
  reviewChangedFilesText,
  reviewDiffPathsToLoad,
  reviewFileTreeStatusLabel,
  reviewFileTreeToggleLabel,
  reviewFileTreeWidth,
  reviewLatestSelectedFilePath,
} from "../src/lib/review-panel-ui";

test("reviewChangedFilesText describes the number of changed files", () => {
  expect(reviewChangedFilesText(0)).toBe("0 files changed");
  expect(reviewChangedFilesText(1)).toBe("1 file changed");
  expect(reviewChangedFilesText(2)).toBe("2 files changed");
});

test("reviewFileTreeToggleLabel describes the action for the current file tree state", () => {
  expect(reviewFileTreeToggleLabel(true)).toBe("Hide changed files");
  expect(reviewFileTreeToggleLabel(false)).toBe("Show changed files");
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
