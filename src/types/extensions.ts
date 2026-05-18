import type { JsonSchema, RoderExtensionActivationEvent, RoderExtensionCapability, RoderPreferenceType } from "@roderai/extension-api";

export type RoderExtensionManifest = {
  id: string;
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  description: string;
  engines: {
    roder: string;
  };
  main: string;
  activationEvents: RoderExtensionActivationEvent[];
  contributes: {
    commands: Array<{ id: string; title: string; category?: string; icon?: string }>;
    tools: Array<{ id: string; title: string; description: string; inputSchema: JsonSchema }>;
    configuration: Array<{
      key: string;
      title: string;
      description?: string;
      type: RoderPreferenceType;
      required?: boolean;
      default?: string | boolean | null;
      options?: Array<{ label: string; value: string }>;
    }>;
    views: {
      panels: Array<{ id: string; title: string; icon?: string }>;
    };
  };
  capabilities: RoderExtensionCapability[];
  icon?: string;
  keywords: string[];
  categories: string[];
};

export type ExtensionCapabilityGrant = {
  capability: RoderExtensionCapability;
  status: "granted" | "denied" | "pending";
};

export type ExtensionCatalogRecord = {
  id: string;
  manifest: RoderExtensionManifest;
  source: {
    type: "dev" | "archive";
    path: string;
    archivePath?: string;
  };
  enabled: boolean;
  capabilities: ExtensionCapabilityGrant[];
  preferences: Record<string, string | boolean | null>;
  activationState: "inactive" | "active" | "failed";
  installedAt: string;
  updatedAt: string;
  lastActivatedAt?: string;
  lastError?: string;
  logs: string[];
};

export type ExtensionCatalogSnapshot = {
  extensions: ExtensionCatalogRecord[];
};
