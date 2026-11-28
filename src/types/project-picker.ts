// Mirrors the Electron main-process contract in electron/main/project-picker.ts.

export type ProjectPickerEntry = {
  name: string;
  path: string;
  isGitRepo: boolean;
};

export type ProjectPickerListing = {
  path: string;
  entries: ProjectPickerEntry[];
  truncated: boolean;
};

export type ProjectPickerSearchRequest = {
  query: string;
};

export type ProjectPickerSearchResult = {
  root: string;
  query: string;
  matches: ProjectPickerEntry[];
  truncated: boolean;
  canceled: boolean;
};
