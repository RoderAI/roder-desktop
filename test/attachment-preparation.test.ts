import { expect, test } from "vitest";
import { AttachmentPreparation, attachmentImageType, mergeAttachments } from "../src/lib/attachment-preparation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("preparation blocks immediately until every overlapping batch settles", async () => {
  const coordinator = new AttachmentPreparation();
  const first = deferred<string>();
  const second = deferred<string>();
  const a = coordinator.prepare([first], (item) => item.promise);
  const b = coordinator.prepare([second], (item) => item.promise);
  expect(coordinator.pending).toBe(2);
  second.resolve("second");
  await b;
  expect(coordinator.pending).toBe(1);
  first.resolve("first");
  await a;
  expect(coordinator.pending).toBe(0);
});

test("failed images remain errors instead of silently becoming local files", async () => {
  const coordinator = new AttachmentPreparation();
  const result = await coordinator.prepare(["good.png", "bad.png"], async (name) => {
    if (name === "bad.png") throw new Error("bad.png could not be decoded");
    return { path: name, imageUrl: "data:image/png;base64,YWJj" };
  });
  expect(result).toEqual({
    attachments: [{ path: "good.png", imageUrl: "data:image/png;base64,YWJj" }],
    errors: ["bad.png could not be decoded"],
  });
  expect(coordinator.pending).toBe(0);
});

test("empty MIME types still recognize picked and dropped images by extension", () => {
  for (const name of [
    "screen.PNG",
    "photo.jpg",
    "photo.jpeg",
    "photo.webp",
    "clip.gif",
    "photo.HEIC",
    "photo.heif",
    "photo.avif",
  ]) {
    expect(attachmentImageType({ name, type: "" })).toMatch(/^image\//);
  }
  expect(attachmentImageType({ name: "unknown", type: "image/png" })).toBe("image/png");
  expect(attachmentImageType({ name: "report.pdf", type: "" })).toBeUndefined();
});

test("synchronous preparation errors are visible and release the pending guard", async () => {
  const coordinator = new AttachmentPreparation();
  const result = await coordinator.prepare(["image.png"], () => {
    throw new ReferenceError("createImageBitmap is not defined");
  });
  expect(result?.attachments).toEqual([]);
  expect(result?.errors).toEqual(["createImageBitmap is not defined"]);
  expect(coordinator.pending).toBe(0);
});

test("asynchronous batches merge with current attachments without restoring removals or duplicating paths", async () => {
  const coordinator = new AttachmentPreparation();
  const delayed = deferred<{ path: string }>();
  let current = [{ path: "removed.png" }];
  const preparation = coordinator
    .prepare([delayed], (item) => item.promise)
    .then((result) => {
      if (result) current = mergeAttachments(current, result.attachments);
    });
  current = [{ path: "added.png" }];
  delayed.resolve({ path: "ready.png" });
  await preparation;
  expect(current).toEqual([{ path: "added.png" }, { path: "ready.png" }]);
  expect(mergeAttachments(current, [{ path: "ready.png" }, { path: "new.png" }, { path: "new.png" }])).toEqual([
    ...current,
    { path: "new.png" },
  ]);
});

test("context changes discard old attachments and errors without affecting new pending work", async () => {
  const coordinator = new AttachmentPreparation();
  const oldFile = deferred<string>();
  const newFile = deferred<string>();
  const oldWork = coordinator.prepare([oldFile], (item) => item.promise);
  coordinator.invalidate();
  expect(coordinator.pending).toBe(0);
  const newWork = coordinator.prepare([newFile], (item) => item.promise);
  oldFile.resolve("old-thread.png");
  expect(await oldWork).toBeNull();
  expect(coordinator.pending).toBe(1);
  newFile.resolve("new-thread.png");
  expect(await newWork).toEqual({ attachments: ["new-thread.png"], errors: [] });
  expect(coordinator.pending).toBe(0);
});

test("unmount invalidation suppresses late decode errors", async () => {
  const coordinator = new AttachmentPreparation();
  const image = deferred<string>();
  const work = coordinator.prepare([image], async (item) => {
    await item.promise;
    throw new Error("Decode failed after unmount");
  });
  coordinator.invalidate();
  image.resolve("ready");
  expect(await work).toBeNull();
  expect(coordinator.pending).toBe(0);
});
