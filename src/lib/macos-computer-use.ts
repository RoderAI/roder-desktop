export type MacComputerUsePermission = "accessibility" | "screenRecording";

export type MacComputerUsePermissions = Record<MacComputerUsePermission, boolean | null> & {
  installed: boolean;
};
