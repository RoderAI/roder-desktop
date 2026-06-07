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

export type BrowserPageSnapshot = {
  visible: boolean;
  url: string;
  title: string;
  text: string;
  controls: Array<{
    ref: string;
    tag: string;
    text: string;
    ariaLabel: string | null;
    role: string | null;
    type: string | null;
    selector: string;
    box: { x: number; y: number; width: number; height: number };
  }>;
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
    this.#showView(bounds);
    if (this.#view!.webContents.getURL() === "") {
      void this.#view!.webContents.loadURL(this.#url);
    }
    return this.snapshot();
  }

  ensureVisible(bounds?: Rectangle): BrowserSnapshot {
    this.#ensureView();
    if (!this.#visible) {
      this.#showView(bounds ?? defaultBrowserBounds(this.#window));
    }
    return this.snapshot();
  }

  async pageSnapshot(): Promise<BrowserPageSnapshot> {
    this.#ensureVisible();
    await this.waitForLoad();
    return this.#view!.webContents.executeJavaScript(pageSnapshotScript(), true) as Promise<BrowserPageSnapshot>;
  }

  async evaluate(expression: string): Promise<unknown> {
    this.#ensureVisible();
    await this.waitForLoad();
    return this.#view!.webContents.executeJavaScript(expression, true) as Promise<unknown>;
  }

  async click(target: { selector?: string; text?: string; ref?: string }): Promise<BrowserSnapshot> {
    this.#ensureVisible();
    await this.waitForLoad();
    const clicked = await this.#view!.webContents.executeJavaScript(clickScript(target), true);
    if (!clicked) {
      throw new Error("No matching visible browser element was found to click");
    }
    return this.snapshot();
  }

  async type(target: { text: string; selector?: string; ref?: string; submit?: boolean }): Promise<BrowserSnapshot> {
    this.#ensureVisible();
    await this.waitForLoad();
    const typed = await this.#view!.webContents.executeJavaScript(typeScript(target), true);
    if (!typed) {
      throw new Error("No matching editable browser element was found to type into");
    }
    return this.snapshot();
  }

  keypress(key: string): BrowserSnapshot {
    this.#ensureVisible();
    this.#view!.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
    this.#view!.webContents.sendInputEvent({ type: "keyUp", keyCode: key });
    return this.snapshot();
  }

  scroll(delta: { dx?: number; dy?: number; selector?: string }): BrowserSnapshot {
    this.#ensureVisible();
    if (delta.selector) {
      void this.#view!.webContents.executeJavaScript(scrollElementScript(delta), true);
    } else {
      this.#view!.webContents.sendInputEvent({
        type: "mouseWheel",
        x: 10,
        y: 10,
        deltaX: delta.dx ?? 0,
        deltaY: delta.dy ?? 0,
      });
    }
    return this.snapshot();
  }

  async waitForLoad(): Promise<BrowserSnapshot> {
    this.#ensureVisible();
    const webContents = this.#view!.webContents;
    if (webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        const done = () => {
          webContents.off("did-finish-load", done);
          webContents.off("did-fail-load", done);
          resolve();
        };
        webContents.once("did-finish-load", done);
        webContents.once("did-fail-load", done);
        const timer = setTimeout(done, 5000);
        if (typeof timer === "object" && "unref" in timer) {
          timer.unref();
        }
      });
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

  #showView(bounds: Rectangle): void {
    this.#visible = true;
    this.#window?.contentView.addChildView(this.#view!);
    this.setBounds(bounds);
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

  #ensureVisible(): void {
    this.#ensureView();
    if (!this.#visible) {
      this.show({ x: 0, y: 0, width: 900, height: 640 });
    }
  }
}

function scriptString(value: unknown): string {
  return JSON.stringify(value);
}

function pageSnapshotScript(): string {
  return `
(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width >= 1 && rect.height >= 1 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth && style.visibility !== "hidden" && style.display !== "none";
  };
  const selectorFor = (element) => {
    if (element.id) return "#" + CSS.escape(element.id);
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 4) {
      let part = current.tagName.toLowerCase();
      if (current.classList.length) part += "." + Array.from(current.classList).slice(0, 2).map((item) => CSS.escape(item)).join(".");
      const parent = current.parentElement;
      if (parent) part += ":nth-child(" + (Array.from(parent.children).indexOf(current) + 1) + ")";
      parts.unshift(part);
      current = parent;
    }
    return parts.join(" > ");
  };
  const candidates = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]')).filter(visible).slice(0, 120);
  const controls = candidates.map((element, index) => {
    const ref = "browser-" + (index + 1);
    element.setAttribute("data-roder-ref", ref);
    const rect = element.getBoundingClientRect();
    return {
      ref,
      tag: element.tagName.toLowerCase(),
      text: (element.innerText || element.value || element.textContent || "").trim().slice(0, 160),
      ariaLabel: element.getAttribute("aria-label"),
      role: element.getAttribute("role"),
      type: element.getAttribute("type"),
      selector: selectorFor(element),
      box: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  });
  return { visible: true, url: location.href, title: document.title, text: (document.body?.innerText || "").trim().slice(0, 12000), controls };
})()
`;
}

function clickScript(target: { selector?: string; text?: string; ref?: string }): string {
  return `
(() => {
  const target = ${scriptString(target)};
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width >= 1 && rect.height >= 1 && style.visibility !== "hidden" && style.display !== "none";
  };
  let element = null;
  if (target.ref) element = document.querySelector('[data-roder-ref="' + CSS.escape(target.ref) + '"]');
  if (!element && target.selector) element = document.querySelector(target.selector);
  if (!element && target.text) {
    const needle = String(target.text).toLowerCase();
    element = Array.from(document.querySelectorAll('a[href],button,[role="button"],[role="link"],input[type="button"],input[type="submit"]')).find((candidate) => visible(candidate) && ((candidate.innerText || candidate.value || candidate.textContent || "").trim().toLowerCase().includes(needle)));
  }
  if (!element || !visible(element)) return false;
  element.scrollIntoView({ block: "center", inline: "center" });
  element.click();
  return true;
})()
`;
}

function typeScript(target: { text: string; selector?: string; ref?: string; submit?: boolean }): string {
  return `
(() => {
  const target = ${scriptString(target)};
  let element = null;
  if (target.ref) element = document.querySelector('[data-roder-ref="' + CSS.escape(target.ref) + '"]');
  if (!element && target.selector) element = document.querySelector(target.selector);
  if (!element) element = document.activeElement;
  if (!element) return false;
  element.scrollIntoView?.({ block: "center", inline: "center" });
  element.focus?.();
  const text = String(target.text ?? "");
  if (element.isContentEditable) {
    element.textContent = text;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  } else if ("value" in element) {
    element.value = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    return false;
  }
  if (target.submit) {
    const form = element.form || element.closest?.("form");
    if (form) form.requestSubmit?.();
    else element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }
  return true;
})()
`;
}

function scrollElementScript(delta: { dx?: number; dy?: number; selector?: string }): string {
  return `
(() => {
  const delta = ${scriptString(delta)};
  const element = document.querySelector(delta.selector);
  if (!element) return false;
  element.scrollBy({ left: delta.dx || 0, top: delta.dy || 0, behavior: "instant" });
  return true;
})()
`;
}

function defaultBrowserBounds(window: BrowserWindow | null): Rectangle {
  const content = window?.getContentBounds();
  if (!content) {
    return { x: 0, y: 0, width: 640, height: 480 };
  }
  const width = Math.max(360, Math.floor(content.width * 0.4));
  return {
    x: Math.max(0, content.width - width),
    y: 0,
    width,
    height: Math.max(240, content.height),
  };
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
