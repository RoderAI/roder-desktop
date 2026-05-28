export const extensionsIpc = {
  list: () => window.roderDesktop.extensionsList(),
  installFromFolder: (folderPath: string) => window.roderDesktop.extensionsInstallFromFolder(folderPath),
  installFromArchive: (archivePath: string) => window.roderDesktop.extensionsInstallFromArchive(archivePath),
  selectAndInstallFolder: () => window.roderDesktop.extensionsSelectAndInstallFolder(),
  selectAndInstallArchive: () => window.roderDesktop.extensionsSelectAndInstallArchive(),
  uninstall: (id: string) => window.roderDesktop.extensionsUninstall(id),
  enable: (id: string) => window.roderDesktop.extensionsEnable(id),
  disable: (id: string) => window.roderDesktop.extensionsDisable(id),
  reload: (id: string) => window.roderDesktop.extensionsReload(id),
  updatePreference: (id: string, key: string, value: string | boolean | null) =>
    window.roderDesktop.extensionsUpdatePreference(id, key, value),
  readLogs: (id: string) => window.roderDesktop.extensionsReadLogs(id),
  activate: (id: string) => window.roderDesktop.extensionsActivate(id),
  executeCommand: (commandId: string, args?: unknown[]) =>
    window.roderDesktop.extensionsExecuteCommand(commandId, args),
  executeTool: (toolId: string, input?: Record<string, unknown>) =>
    window.roderDesktop.extensionsExecuteTool(toolId, input),
  readPanel: (extensionId: string, panelId: string) => window.roderDesktop.extensionsReadPanel(extensionId, panelId),
  readTheme: (extensionId: string, themeId: string) => window.roderDesktop.extensionsReadTheme(extensionId, themeId),
};

export type ExtensionsIpc = typeof extensionsIpc;
