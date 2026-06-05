import { expect, test } from "vitest";
import { normalizeApplyPatchPreview, normalizedToolPreview } from "../src/lib/tool-preview";

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
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "",
    ].join("\n"),
  });
});
