import { expect, test, vi } from "vitest";
import type { DesktopAttachment } from "../src/types/roder";

async function setup() {
  vi.resetModules();
  const request = vi
    .fn<(method: string, params?: unknown) => Promise<unknown>>()
    .mockResolvedValue({ turnId: "turn-1" });
  globalThis.window = { roderDesktop: { request } } as unknown as Window & typeof globalThis;
  const { roderIpc } = await import("../src/lib/roder-ipc");
  return { request, roderIpc };
}

test.each(["file", "clipboard", "browser", "canvas"] as const)(
  "%s images are delivered as model image input even without text",
  async (source) => {
    const { request, roderIpc } = await setup();
    const attachment: DesktopAttachment = {
      id: "image-1",
      name: "screenshot.png",
      type: "image/png",
      path: "/tmp/screenshot.png",
      imageUrl: "data:image/png;base64,cG5n",
      source,
      size: 3,
    };
    await roderIpc.startTurn("thread-1", "", [attachment]);
    expect(request).toHaveBeenCalledWith("turn/start", {
      threadId: "thread-1",
      input: [{ type: "image", imageUrl: attachment.imageUrl }],
    });
    request.mockClear();
    await roderIpc.steerTurn("thread-1", "turn-1", "", [attachment]);
    expect(request).toHaveBeenCalledWith("turn/steer", {
      threadId: "thread-1",
      expectedTurnId: "turn-1",
      input: [{ type: "image", imageUrl: attachment.imageUrl }],
    });
  },
);

test.each(["image/png", ""])(
  "path-only images (%s) fail visibly instead of sending text without the image",
  async (type) => {
    const { request, roderIpc } = await setup();
    const image: DesktopAttachment = {
      id: "image-1",
      name: "screenshot.PNG",
      type,
      path: "/tmp/screenshot.PNG",
      size: 3,
      source: "file",
    };
    expect(() => roderIpc.startTurn("thread-1", "look at this", [image])).toThrow(/not ready.*reattach/i);
    expect(() => roderIpc.steerTurn("thread-1", "turn-1", "look at this", [image])).toThrow(/not ready.*reattach/i);
    expect(request).not.toHaveBeenCalled();
  },
);
