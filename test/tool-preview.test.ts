import { expect, test } from "vitest";
import { parsePatchFiles } from "@pierre/diffs";
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
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "diff --git a/docs/intro.md b/docs/intro.md",
      "--- /dev/null",
      "+++ b/docs/intro.md",
      "@@ -0,0 +1,1 @@",
      "+hello",
      "",
    ].join("\n"),
  );
});

test("normalizes bare apply_patch hunks with parseable line ranges", () => {
  const preview = normalizeApplyPatchPreview(
    [
      "*** Begin Patch",
      "*** Update File: src/app.ts",
      "@@",
      " old context",
      "-old",
      "+new",
      " next context",
      "*** End Patch",
    ].join("\n"),
  );

  expect(preview).toContain("@@ -1,3 +1,3 @@");
  expect(parsePatchFiles(preview ?? "")[0]?.files[0]?.hunks[0]?.hunkContent.length).toBeGreaterThan(0);
});

test("marks apply_patch previews as patch previews", () => {
  expect(normalizedToolPreview("apply_patch", "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-old\n+new")).toEqual({
    kind: "patch",
    text: [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,1 +1,1 @@",
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
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n"),
    [
      "diff --git a/docs/intro.md b/docs/intro.md",
      "--- /dev/null",
      "+++ b/docs/intro.md",
      "@@ -0,0 +1,1 @@",
      "+hello",
      "",
    ].join("\n"),
  ]);
});

test("ignores malformed patch text when splitting unified diffs", () => {
  expect(splitUnifiedDiffFiles("not a patch\n+line\n")).toEqual([]);
});
