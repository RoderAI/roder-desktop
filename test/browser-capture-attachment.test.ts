import { readFile, unlink } from "node:fs/promises";
import { expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class {},
  WebContentsView: class {
    webContents = {
      capturePage: async () => ({ toPNG: () => Buffer.from("test-png") }),
      on: () => {},
      setWindowOpenHandler: () => {},
    };
    setBackgroundColor() {}
  },
}));
vi.mock("../electron/main/shortcuts", () => ({ installNewThreadShortcut: () => {} }));

test("browser screenshot attachments carry the same image bytes that were saved to disk", async () => {
  const { BrowserManager } = await import("../electron/browser/browser-manager");
  const manager = new BrowserManager("0", () => {});
  const capture = await manager.captureScreenshot();
  try {
    const bytes = await readFile(capture.path);
    expect(capture.imageUrl).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
    expect(capture.size).toBe(bytes.length);
    expect(capture.type).toBe("image/png");
  } finally {
    await unlink(capture.path);
  }
});
