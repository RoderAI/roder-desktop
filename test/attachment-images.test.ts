import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { savePngDataUrl } from "../electron/attachment-images";

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

test("concurrent images have distinct paths even when saved in the same millisecond", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
  const directory = `roder-attachment-test-${randomUUID()}`;
  directories.push(join(tmpdir(), directory));
  const images = await Promise.all([
    savePngDataUrl("data:image/png;base64,b25l", "clipboard", directory),
    savePngDataUrl("data:image/png;base64,dHdv", "clipboard", directory),
  ]);
  expect(new Set(images.map((image) => image.path)).size).toBe(2);
  expect(await readFile(images[0].path, "utf8")).toBe("one");
  expect(await readFile(images[1].path, "utf8")).toBe("two");
  expect(images.map((image) => image.imageUrl)).toEqual(["data:image/png;base64,b25l", "data:image/png;base64,dHdv"]);
});
