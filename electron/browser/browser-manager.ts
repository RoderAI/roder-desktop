import { BrowserWindow, WebContentsView, type Rectangle, type WebContents } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { installNewThreadShortcut } from "../main/shortcuts";

export type BrowserSnapshot = {
  visible: boolean;
  url: string;
  cdpUrl: string;
  canGoBack: boolean;
  canGoForward: boolean;
  annotating: boolean;
};

export type BrowserCapture = {
  name: string;
  path: string;
  type: string;
  size: number;
};

export class BrowserManager {
  #window: BrowserWindow | null = null;
  #view: WebContentsView | null = null;
  #visible = false;
  #url = "https://www.google.com/search?q=roder";
  #annotating = false;

  constructor(
    private readonly cdpPort: string,
    private readonly onNewThreadShortcut: () => void,
  ) {}

  attach(window: BrowserWindow): void {
    this.#window = window;
  }

  show(bounds: Rectangle): BrowserSnapshot {
    this.#ensureView();
    this.#visible = true;
    this.#window?.contentView.addChildView(this.#view!);
    this.setBounds(bounds);
    if (this.#view!.webContents.getURL() === "") {
      void this.#view!.webContents.loadURL(this.#url);
    }
    return this.snapshot();
  }

  hide(): BrowserSnapshot {
    this.#visible = false;
    if (this.#view) {
      this.#window?.contentView.removeChildView(this.#view);
    }
    return this.snapshot();
  }

  toggle(bounds?: Rectangle): BrowserSnapshot {
    if (this.#visible) {
      return this.hide();
    }
    return this.show(bounds ?? { x: 0, y: 0, width: 640, height: 480 });
  }

  navigate(url: string): BrowserSnapshot {
    const normalizedUrl = normalizeUrl(url);
    this.#url = normalizedUrl;
    this.#ensureView();
    void this.#view!.webContents.loadURL(normalizedUrl);
    return this.snapshot();
  }

  goBack(): BrowserSnapshot {
    this.#ensureView();
    if (canGoBack(this.#view!.webContents)) {
      goBack(this.#view!.webContents);
    }
    return this.snapshot();
  }

  goForward(): BrowserSnapshot {
    this.#ensureView();
    if (canGoForward(this.#view!.webContents)) {
      goForward(this.#view!.webContents);
    }
    return this.snapshot();
  }

  refresh(): BrowserSnapshot {
    this.#ensureView();
    this.#view!.webContents.reload();
    return this.snapshot();
  }

  async captureScreenshot(): Promise<BrowserCapture> {
    this.#ensureView();
    const image = await this.#view!.webContents.capturePage();
    const data = image.toPNG();
    const dir = join(tmpdir(), "roder-desktop-browser");
    await mkdir(dir, { recursive: true });
    const name = `browser-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    const path = join(dir, name);
    await writeFile(path, data);
    return {
      name: basename(path),
      path,
      type: "image/png",
      size: data.byteLength,
    };
  }

  async toggleAnnotation(): Promise<BrowserSnapshot> {
    this.#ensureView();
    await this.#view!.webContents.executeJavaScript(annotationScript(), true);
    this.#annotating = !this.#annotating;
    return this.snapshot();
  }

  setBounds(bounds: Rectangle): BrowserSnapshot {
    if (this.#view && this.#visible) {
      this.#view.setBounds(bounds);
    }
    return this.snapshot();
  }

  snapshot(): BrowserSnapshot {
    return {
      visible: this.#visible,
      url: this.#view?.webContents.getURL() || this.#url,
      cdpUrl: `http://127.0.0.1:${this.cdpPort}/json`,
      canGoBack: this.#view ? canGoBack(this.#view.webContents) : false,
      canGoForward: this.#view ? canGoForward(this.#view.webContents) : false,
      annotating: this.#annotating,
    };
  }

  destroy(): void {
    if (this.#view) {
      this.#window?.contentView.removeChildView(this.#view);
      this.#view.webContents.close();
      this.#view = null;
    }
    this.#visible = false;
  }

  #ensureView(): void {
    if (this.#view) {
      return;
    }
    this.#view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        devTools: true,
      },
    });
    this.#view.setBackgroundColor("#111111");
    installNewThreadShortcut(this.#view.webContents, this.onNewThreadShortcut);
    this.#view.webContents.on("did-navigate", (_event, url) => {
      this.#url = url;
      this.#annotating = false;
    });
    this.#view.webContents.on("did-navigate-in-page", (_event, url) => {
      this.#url = url;
    });
    this.#view.webContents.setWindowOpenHandler(({ url }) => {
      void this.navigate(url);
      return { action: "deny" };
    });
  }
}

function canGoBack(webContents: WebContents): boolean {
  return navigationHistory(webContents)?.canGoBack?.() ?? false;
}

function canGoForward(webContents: WebContents): boolean {
  return navigationHistory(webContents)?.canGoForward?.() ?? false;
}

function goBack(webContents: WebContents): void {
  navigationHistory(webContents)?.goBack?.();
}

function goForward(webContents: WebContents): void {
  navigationHistory(webContents)?.goForward?.();
}

function navigationHistory(webContents: WebContents): {
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  goBack?: () => void;
  goForward?: () => void;
} | null {
  return (
    (
      webContents as WebContents & {
        navigationHistory?: {
          canGoBack?: () => boolean;
          canGoForward?: () => boolean;
          goBack?: () => void;
          goForward?: () => void;
        };
      }
    ).navigationHistory ?? null
  );
}

function annotationScript(): string {
  return `
(() => {
  const existing = document.getElementById("roder-browser-annotations");
  if (existing) {
    existing.remove();
    return false;
  }

  const root = document.createElement("div");
  root.id = "roder-browser-annotations";
  root.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;";

  const selectors = [
    "a[href]",
    "button",
    "input",
    "textarea",
    "select",
    "[role=button]",
    "[role=link]",
    "[contenteditable=true]",
    "img",
    "h1",
    "h2",
  ].join(",");

  const elements = Array.from(document.querySelectorAll(selectors))
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width >= 8 && rect.height >= 8 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth && style.visibility !== "hidden" && style.display !== "none";
    })
    .slice(0, 80);

  for (const [index, element] of elements.entries()) {
    const rect = element.getBoundingClientRect();
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:" + Math.max(0, rect.left) + "px;top:" + Math.max(0, rect.top) + "px;width:" + rect.width + "px;height:" + rect.height + "px;border:2px solid #d946ef;border-radius:6px;box-shadow:0 0 0 1px rgba(255,255,255,.75),0 8px 24px rgba(0,0,0,.25);";

    const label = document.createElement("div");
    label.textContent = String(index + 1);
    label.style.cssText = "position:absolute;left:-2px;top:-22px;min-width:22px;height:20px;padding:0 6px;border-radius:8px 8px 8px 0;background:#d946ef;color:white;font-size:12px;line-height:20px;font-weight:700;text-align:center;";
    box.appendChild(label);
    root.appendChild(box);
  }

  document.documentElement.appendChild(root);
  return true;
})()
`;
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "about:blank";
  }
  if (/^[a-z]+:\/\//i.test(trimmed) || trimmed.startsWith("about:")) {
    return trimmed;
  }
  if (trimmed.includes(".") && !trimmed.includes(" ")) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}
