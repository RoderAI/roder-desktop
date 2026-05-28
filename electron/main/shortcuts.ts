import type { MenuItemConstructorOptions, WebContents } from "electron";

export type AppCommand = "newProject" | "newThread";

export type ShortcutInput = {
  type: string;
  key: string;
  code?: string;
  isAutoRepeat?: boolean;
  isComposing?: boolean;
  shift?: boolean;
  control?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export function isNewThreadShortcutInput(input: ShortcutInput, platform: NodeJS.Platform = process.platform): boolean {
  return isShortcutInputForKey(input, "n", "KeyN", platform);
}

export function isNewProjectShortcutInput(input: ShortcutInput, platform: NodeJS.Platform = process.platform): boolean {
  return isShortcutInputForKey(input, "o", "KeyO", platform);
}

function isShortcutInputForKey(input: ShortcutInput, key: string, code: string, platform: NodeJS.Platform): boolean {
  if (input.type !== "keyDown" || input.isAutoRepeat || input.isComposing) {
    return false;
  }
  if (input.shift || input.alt) {
    return false;
  }
  const isExpectedKey = input.key.toLowerCase() === key || input.code === code;
  if (!isExpectedKey) {
    return false;
  }
  return platform === "darwin" ? Boolean(input.meta && !input.control) : Boolean(input.control && !input.meta);
}

export function installNewThreadShortcut(webContents: WebContents, onNewThread: () => void): void {
  webContents.on("before-input-event", (event, input) => {
    if (!isNewThreadShortcutInput(input)) {
      return;
    }
    event.preventDefault();
    onNewThread();
  });
}

export function installNewProjectShortcut(webContents: WebContents, onNewProject: () => void): void {
  webContents.on("before-input-event", (event, input) => {
    if (!isNewProjectShortcutInput(input)) {
      return;
    }
    event.preventDefault();
    onNewProject();
  });
}

export function createApplicationMenuTemplate(
  onCommand: (command: AppCommand) => void,
  platform: NodeJS.Platform = process.platform,
): MenuItemConstructorOptions[] {
  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        id: "new-project",
        label: "Add Project...",
        accelerator: "CommandOrControl+O",
        click: () => onCommand("newProject"),
      },
      {
        id: "new-thread",
        label: "New Agent",
        accelerator: "CommandOrControl+N",
        click: () => onCommand("newThread"),
      },
      { type: "separator" },
      platform === "darwin" ? { role: "close" } : { role: "quit" },
    ],
  };

  return [
    ...(platform === "darwin" ? [{ role: "appMenu" } satisfies MenuItemConstructorOptions] : []),
    fileMenu,
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
}
