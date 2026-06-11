import { expect, test } from "vitest";
import {
  normalizeApplyPatchPreview,
  normalizedToolPreview,
  splitUnifiedDiffFiles,
  summarizeApplyPatch,
} from "../src/lib/tool-preview";

test("normalizes apply_patch payloads into unified diffs", () => {
  expect(
    normalizeApplyPatchPreview(
      [
        "*** Begin Patch",
        "*** Update File: src/app.ts",
        "@@",
        "-old",
        "+new",
        "*** Add File: docs/intro.md",
        "+hello",
        "*** End Patch",
      ].join("\n"),
    ),
  ).toBe(
    [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -0,0 +0,0 @@",
      "-old",
      "+new",
      "diff --git a/docs/intro.md b/docs/intro.md",
      "--- /dev/null",
      "+++ b/docs/intro.md",
      "+hello",
      "",
    ].join("\n"),
  );
});

test("marks apply_patch previews as patch previews", () => {
  expect(normalizedToolPreview("apply_patch", "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-old\n+new")).toEqual({
    kind: "patch",
    text: [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -0,0 +0,0 @@",
      "-old",
      "+new",
      "",
    ].join("\n"),
  });
});

test("summarizes apply_patch files and change counts", () => {
  expect(
    summarizeApplyPatch(
      [
        "*** Begin Patch",
        "*** Update File: src/app.ts",
        "@@",
        "-old",
        "+new",
        "+another",
        "*** Add File: docs/intro.md",
        "+hello",
        "*** End Patch",
      ].join("\n"),
    ),
  ).toEqual({ files: ["src/app.ts", "docs/intro.md"], additions: 3, deletions: 1 });
});

test("splits normalized apply_patch previews into one-file diffs", () => {
  const preview = normalizeApplyPatchPreview(
    [
      "*** Begin Patch",
      "*** Update File: src/app.ts",
      "@@",
      "-old",
      "+new",
      "*** Add File: docs/intro.md",
      "+hello",
      "*** End Patch",
    ].join("\n"),
  );

  expect(splitUnifiedDiffFiles(preview ?? "")).toEqual([
    [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -0,0 +0,0 @@",
      "-old",
      "+new",
      "",
    ].join("\n"),
    ["diff --git a/docs/intro.md b/docs/intro.md", "--- /dev/null", "+++ b/docs/intro.md", "+hello", ""].join("\n"),
  ]);
});

test("ignores malformed patch text when splitting unified diffs", () => {
  expect(splitUnifiedDiffFiles("not a patch\n+line\n")).toEqual([]);
});
