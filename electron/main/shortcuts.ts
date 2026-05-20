import type { MenuItemConstructorOptions, WebContents } from "electron";

export type AppCommand = "newThread";

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
  if (input.type !== "keyDown" || input.isAutoRepeat || input.isComposing) {
    return false;
  }
  if (input.shift || input.alt) {
    return false;
  }
  const isNKey = input.key.toLowerCase() === "n" || input.code === "KeyN";
  if (!isNKey) {
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

export function createApplicationMenuTemplate(
  onCommand: (command: AppCommand) => void,
  platform: NodeJS.Platform = process.platform,
): MenuItemConstructorOptions[] {
  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
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
