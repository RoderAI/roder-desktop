import {
  CheckCircle2,
  Cloud,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Network,
  Pencil,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Ship,
  Square,
  Terminal,
  Trash2,
  Unplug,
} from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";
import {
  parseQuickSshInput,
  validateMachineConfig,
  WINDOWS_CLOUD_MACHINES_NOTICE,
  type BoatSandboxSize,
  type BoatSandboxSummary,
  type CloudMachineTestResult,
  type SshConfigHostEntry,
} from "@/lib/cloud-machines";
import { machineProviderHelp } from "@/lib/cloud-machine-providers";
import { roderIpc } from "@/lib/roder-ipc";
import { cn } from "@/lib/utils";
import { useCloudMachinesStore } from "@/stores/cloud-machines-store";

const fieldClass =
  "min-h-8 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function SettingsCloudMachinesPanel(): React.JSX.Element {
  const machines = useCloudMachinesStore((state) => state.machines);
  const providers = useCloudMachinesStore((state) => state.providers);
  const credentialStatuses = useCloudMachinesStore((state) => state.credentialStatuses) ?? [];
  const blaxelCli = useCloudMachinesStore((state) => state.blaxelCli) ?? null;
  const blaxelWorkspaces = useCloudMachinesStore((state) => state.blaxelWorkspaces) ?? [];
  const blaxelSandboxes = useCloudMachinesStore((state) => state.blaxelSandboxes) ?? [];
  const blaxelActiveWorkspace = useCloudMachinesStore((state) => state.blaxelActiveWorkspace) ?? null;
  const boatCredentials = useCloudMachinesStore((state) => state.boatCredentials) ?? null;
  const boatAuthState = useCloudMachinesStore((state) => state.boatAuthState) ?? null;
  const boatSandboxes = useCloudMachinesStore((state) => state.boatSandboxes) ?? [];
  const localTailscale = useCloudMachinesStore((state) => state.localTailscale) ?? null;
  const tailscaleCredentials = useCloudMachinesStore((state) => state.tailscaleCredentials) ?? null;
  const localSsh = useCloudMachinesStore((state) => state.localSsh) ?? null;
  const loadingSandboxes = useCloudMachinesStore((state) => state.loadingSandboxes) ?? false;
  const savingCredentials = useCloudMachinesStore((state) => state.savingCredentials) ?? false;
  const busy = useCloudMachinesStore((state) => state.busy);
  const error = useCloudMachinesStore((state) => state.error);
  const refresh = useCloudMachinesStore((state) => state.refresh);
  const refreshBoatSandboxes = useCloudMachinesStore((state) => state.refreshBoatSandboxes);
  const startBoatOAuth = useCloudMachinesStore((state) => state.startBoatOAuth);
  const cancelBoatOAuth = useCloudMachinesStore((state) => state.cancelBoatOAuth);
  const saveBoatApiKey = useCloudMachinesStore((state) => state.saveBoatApiKey);
  const createBoatSandbox = useCloudMachinesStore((state) => state.createBoatSandbox);
  const stopBoatSandbox = useCloudMachinesStore((state) => state.stopBoatSandbox);
  const resumeBoatSandbox = useCloudMachinesStore((state) => state.resumeBoatSandbox);
  const refreshTailscale = useCloudMachinesStore((state) => state.refreshTailscale);
  const refreshSsh = useCloudMachinesStore((state) => state.refreshSsh);
  const refreshBlaxelSandboxes = useCloudMachinesStore((state) => state.refreshBlaxelSandboxes);
  const importBlaxelCli = useCloudMachinesStore((state) => state.importBlaxelCli);
  const saveBlaxelCredentials = useCloudMachinesStore((state) => state.saveBlaxelCredentials);
  const saveTailscaleAuthKey = useCloudMachinesStore((state) => state.saveTailscaleAuthKey);
  const saveTailscaleOAuth = useCloudMachinesStore((state) => state.saveTailscaleOAuth);
  const setTailscaleSandboxPreference = useCloudMachinesStore((state) => state.setTailscaleSandboxPreference);
  const saveProviderToken = useCloudMachinesStore((state) => state.saveProviderToken);
  const clearProviderCredentials = useCloudMachinesStore((state) => state.clearProviderCredentials);
  const createBlaxelSandbox = useCloudMachinesStore((state) => state.createBlaxelSandbox);
  const save = useCloudMachinesStore((state) => state.save);
  const remove = useCloudMachinesStore((state) => state.remove);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useState<"machines" | "connections">("machines");
  const [showMachineForm, setShowMachineForm] = useState(false);
  const [name, setName] = useState("");
  const [providerId, setProviderId] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [readRoots, setReadRoots] = useState("");
  const [configText, setConfigText] = useState("{}");
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  // Boat credentials & guided sandbox state
  const [showBoatKeyForm, setShowBoatKeyForm] = useState(false);
  const [boatApiKey, setBoatApiKey] = useState("");
  const [boatFeedback, setBoatFeedback] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [boatMode, setBoatMode] = useState<"existing" | "create">("existing");
  const [selectedBoatSandboxId, setSelectedBoatSandboxId] = useState("");
  const [boatTailscaleEnabled, setBoatTailscaleEnabled] = useState(true);
  const [newBoatSandboxName, setNewBoatSandboxName] = useState("");
  const [newBoatSandboxSize, setNewBoatSandboxSize] = useState<BoatSandboxSize>("default");
  const [newBoatSandboxEnvironment, setNewBoatSandboxEnvironment] = useState("");
  const [boatSandboxActionId, setBoatSandboxActionId] = useState<string | null>(null);

  // Blaxel credentials form state
  const [showBlaxelKeyForm, setShowBlaxelKeyForm] = useState(false);
  const [blaxelApiKey, setBlaxelApiKey] = useState("");
  const [blaxelWorkspaceInput, setBlaxelWorkspaceInput] = useState("");
  const [credentialFeedback, setCredentialFeedback] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  // Tailscale sandbox-tunnel credentials form state
  const [showTailscaleForm, setShowTailscaleForm] = useState(false);
  const [tailscaleAuthMode, setTailscaleAuthMode] = useState<"oauth" | "auth-key">("oauth");
  const [tailscaleAuthKeyInput, setTailscaleAuthKeyInput] = useState("");
  const [tailscaleOAuthClientId, setTailscaleOAuthClientId] = useState("");
  const [tailscaleOAuthClientSecret, setTailscaleOAuthClientSecret] = useState("");
  const [tailscaleTagsInput, setTailscaleTagsInput] = useState("tag:roder");
  const [tailscaleTailnetInput, setTailscaleTailnetInput] = useState("");
  const [tailscaleFeedback, setTailscaleFeedback] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  // Generic provider token input (for Sprites / gateway providers)
  const [providerTokenInput, setProviderTokenInput] = useState("");

  // Guided Blaxel sandbox picker / creation state
  const [blaxelMode, setBlaxelMode] = useState<"existing" | "create">("existing");
  const [selectedSandboxName, setSelectedSandboxName] = useState("");
  const [blaxelTailscaleEnabled, setBlaxelTailscaleEnabled] = useState(true);
  const [newSandboxName, setNewSandboxName] = useState("");
  const [newSandboxImage, setNewSandboxImage] = useState("blaxel/py-app:latest");
  const [newSandboxMemory, setNewSandboxMemory] = useState("4096");
  const [creatingSandbox, setCreatingSandbox] = useState(false);

  // Guided Tailscale peer machine state
  const [tailscalePeerHost, setTailscalePeerHost] = useState("");
  const [tailscalePeerIp, setTailscalePeerIp] = useState("");
  const [tailscaleSshUser, setTailscaleSshUser] = useState("");
  const [tailscaleSshPort, setTailscaleSshPort] = useState("22");

  // Guided SSH server state
  const [sshQuickTarget, setSshQuickTarget] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshIdentityFile, setSshIdentityFile] = useState("");
  const [sshProxyJump, setSshProxyJump] = useState("");
  const [sshTailscaleEnabled, setSshTailscaleEnabled] = useState(false);

  // Connection test results keyed by machine ID
  const [testingMachineId, setTestingMachineId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, CloudMachineTestResult>>({});

  const formId = useId();
  const boatProviderAvailable = providers.some((provider) => provider.provider_id === "boat");
  const blaxelProviderAvailable = providers.some((provider) => provider.provider_id === "blaxel");
  const tailscaleProviderAvailable = providers.some((provider) => provider.provider_id === "tailscale");
  const sshProviderAvailable = providers.some((provider) => provider.provider_id === "ssh");
  const boatCredential = credentialStatuses.find((entry) => entry.providerId === "boat") ?? null;
  const boatConnected = Boolean(boatCredentials?.configured || boatCredential?.configured);
  const boatAuthInProgress = boatAuthState?.phase === "awaiting-browser" || boatAuthState?.phase === "exchanging";
  const boatAccountLabel = boatCredentials?.userLogin
    ? boatCredentials.userLogin.includes("@")
      ? boatCredentials.userLogin
      : `@${boatCredentials.userLogin}`
    : boatCredentials?.userDisplayName || boatCredentials?.userEmail || null;
  const blaxelCredential = credentialStatuses.find((entry) => entry.providerId === "blaxel") ?? null;
  const blaxelConnected = Boolean(blaxelCredential?.configured);
  const tailscaleConfigured = Boolean(tailscaleCredentials?.configured);
  const tailscalePeers = localTailscale?.peers ?? [];
  const sshConfigHosts = localSsh?.hosts ?? [];
  const sshIdentityFiles = localSsh?.identityFiles ?? [];
  const onlineTailscalePeerCount = tailscalePeers.filter((peer) => peer.online).length;
  const defaultProvider =
    providers.find((provider) => provider.provider_id === providerId) ??
    (boatProviderAvailable && boatConnected
      ? providers.find((provider) => provider.provider_id === "boat")
      : undefined) ??
    (blaxelProviderAvailable ? providers.find((provider) => provider.provider_id === "blaxel") : undefined) ??
    (boatProviderAvailable ? providers.find((provider) => provider.provider_id === "boat") : undefined) ??
    providers.find((provider) => provider.provider_id !== "unix-local") ??
    providers[0];
  const selectedProvider = defaultProvider;
  const isBoatSelected = selectedProvider?.provider_id === "boat";
  const isBlaxelSelected = selectedProvider?.provider_id === "blaxel";
  const isTailscaleSelected = selectedProvider?.provider_id === "tailscale";
  const isSshSelected = selectedProvider?.provider_id === "ssh";
  const selectedBoatSandbox = boatSandboxes.find((entry) => entry.id === selectedBoatSandboxId) ?? null;
  const providerHelp = machineProviderHelp(selectedProvider?.provider_id ?? "");
  const selectedProviderCredential = selectedProvider
    ? (credentialStatuses.find((entry) => entry.providerId === selectedProvider.provider_id) ?? null)
    : null;
  const cloudSupported = typeof window === "undefined" || window.roderDesktop?.platform !== "win32";
  const effectiveBlaxelWorkspace = blaxelActiveWorkspace || blaxelCredential?.workspace || blaxelCli?.workspace || "";

  useMountEffect(() => {
    void refresh().catch(() => {
      // The store exposes discovery errors without losing saved profiles.
    });
  });

  function resetForm(): void {
    setShowMachineForm(false);
    setEditingId(null);
    setName("");
    setWorkspace("");
    setReadRoots("");
    setConfigText("{}");
    setBoatMode("existing");
    setSelectedBoatSandboxId("");
    setBoatTailscaleEnabled(true);
    setNewBoatSandboxName("");
    setNewBoatSandboxSize("default");
    setNewBoatSandboxEnvironment("");
    setSelectedSandboxName("");
    setBlaxelTailscaleEnabled(true);
    setNewSandboxName("");
    setTailscalePeerHost("");
    setTailscalePeerIp("");
    setTailscaleSshUser("");
    setTailscaleSshPort("22");
    setSshQuickTarget("");
    setSshHost("");
    setSshUser("");
    setSshPort("22");
    setSshIdentityFile("");
    setSshProxyJump("");
    setSshTailscaleEnabled(false);
    setFormError("");
  }

  function openMachineForm(focusField = "name"): void {
    setView("machines");
    setShowMachineForm(true);
    requestAnimationFrame(() => {
      const field = document.getElementById(`${formId}-${focusField}`);
      if (field && !field.matches(":disabled")) {
        field.focus();
      } else {
        document.getElementById(`${formId}-editor`)?.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function syncSshGuidedConfig(next: {
    host: string;
    user: string;
    port: string;
    identityFile: string;
    proxyJump: string;
    tailscaleTunnel: boolean;
  }): void {
    const cleanHost = next.host.trim();
    const cleanUser = next.user.trim();
    const parsedPort = Number.parseInt(next.port.trim(), 10);
    const cleanKey = next.identityFile.trim();
    const cleanJump = next.proxyJump.trim();
    const config: Record<string, unknown> = {
      ...(cleanHost ? { ssh_host: cleanHost } : {}),
      ...(cleanUser ? { ssh_user: cleanUser } : {}),
      ssh_port: Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 22,
      ...(cleanKey ? { identity_file: cleanKey } : {}),
      ...(cleanJump ? { proxy_jump: cleanJump } : {}),
      ...(tailscaleConfigured ? { tailscale_tunnel: next.tailscaleTunnel } : {}),
    };
    setConfigText(JSON.stringify(config, null, 2));
  }

  function importSshConfigHost(entry: SshConfigHostEntry): void {
    const nextPort = String(entry.port || 22);
    const nextUser = entry.user ?? "";
    const nextKey = entry.identityFile ?? "";
    const nextJump = entry.proxyJump ?? "";
    const defaultTs = Boolean(tailscaleCredentials?.configured && tailscaleCredentials.preferForSandboxes);
    setEditingId(null);
    setProviderId("ssh");
    setName(entry.alias);
    setSshQuickTarget("");
    setSshHost(entry.alias);
    setSshUser(nextUser);
    setSshPort(nextPort);
    setSshIdentityFile(nextKey);
    setSshProxyJump(nextJump);
    setSshTailscaleEnabled(defaultTs);
    if (!workspace.trim()) {
      setWorkspace(nextUser === "root" ? "/root" : nextUser ? `/home/${nextUser}` : "/workspace");
    }
    setFormError("");
    setFormNotice(
      `Loaded "${entry.alias}" from ~/.ssh/config. Confirm the remote workspace path and click Add machine.`,
    );
    syncSshGuidedConfig({
      host: entry.alias,
      user: nextUser,
      port: nextPort,
      identityFile: nextKey,
      proxyJump: nextJump,
      tailscaleTunnel: defaultTs,
    });
    openMachineForm("workspace");
  }

  function syncTailscaleGuidedConfig(nextHost: string, nextIp: string, nextUser: string, nextPort: string): void {
    const cleanHost = nextHost.trim();
    const cleanIp = nextIp.trim();
    const cleanUser = nextUser.trim();
    const parsedPort = Number.parseInt(nextPort.trim(), 10);
    const config: Record<string, unknown> = {
      ...(cleanHost ? { tailscale_host: cleanHost } : {}),
      ...(cleanIp ? { tailscale_ip: cleanIp } : {}),
      ...(cleanUser ? { ssh_user: cleanUser } : {}),
      ssh_port: Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 22,
    };
    setConfigText(JSON.stringify(config, null, 2));
  }

  function syncBoatGuidedConfig(
    sandboxId: string,
    sandboxName: string,
    nextWorkspace: string,
    nextTailscale = boatTailscaleEnabled,
  ): void {
    const cleanId = sandboxId.trim();
    const cleanName = sandboxName.trim();
    const cleanWorkspace = nextWorkspace.trim() || "/home/user";
    const config: Record<string, unknown> = {
      ...(cleanId ? { sandbox_id: cleanId } : {}),
      ...(cleanName ? { sandbox_name: cleanName } : {}),
      working_dir: cleanWorkspace,
      ...(tailscaleConfigured ? { tailscale_tunnel: nextTailscale } : {}),
    };
    setConfigText(JSON.stringify(config, null, 2));
  }

  function applyProviderSelection(nextProviderId: string): void {
    setProviderId(nextProviderId);
    setFormError("");
    setFormNotice("");
    if (nextProviderId === "boat") {
      const nextWorkspace = !workspace.trim() || workspace.trim() === "/workspace" ? "/home/user" : workspace.trim();
      setWorkspace(nextWorkspace);
      syncBoatGuidedConfig(selectedBoatSandboxId, selectedBoatSandbox?.name ?? "", nextWorkspace, boatTailscaleEnabled);
    } else if (nextProviderId === "blaxel") {
      if (!workspace.trim()) setWorkspace("/workspace");
      setConfigText(
        JSON.stringify(
          {
            sandbox_name: selectedSandboxName || "",
            working_dir: workspace.trim() || "/workspace",
            ...(effectiveBlaxelWorkspace ? { workspace: effectiveBlaxelWorkspace } : {}),
            cleanup: "keep",
            ...(tailscaleConfigured && !blaxelTailscaleEnabled ? { tailscale_tunnel: false } : {}),
          },
          null,
          2,
        ),
      );
    } else if (nextProviderId === "ssh") {
      const defaultTs = Boolean(tailscaleCredentials?.configured && tailscaleCredentials.preferForSandboxes);
      setSshTailscaleEnabled(defaultTs);
      syncSshGuidedConfig({
        host: sshHost,
        user: sshUser,
        port: sshPort,
        identityFile: sshIdentityFile,
        proxyJump: sshProxyJump,
        tailscaleTunnel: defaultTs,
      });
    } else if (nextProviderId === "tailscale") {
      syncTailscaleGuidedConfig(tailscalePeerHost, tailscalePeerIp, tailscaleSshUser, tailscaleSshPort);
    } else {
      setConfigText("{}");
    }
  }

  function syncBlaxelGuidedConfig(
    sandboxName: string,
    nextWorkspace: string,
    nextTailscale = blaxelTailscaleEnabled,
  ): void {
    const cleanWorkspace = nextWorkspace.trim() || "/workspace";
    const config: Record<string, unknown> = {
      sandbox_name: sandboxName,
      working_dir: cleanWorkspace,
      cleanup: "keep",
      ...(tailscaleConfigured ? { tailscale_tunnel: nextTailscale } : {}),
    };
    if (effectiveBlaxelWorkspace) {
      config.workspace = effectiveBlaxelWorkspace;
    }
    setConfigText(JSON.stringify(config, null, 2));
  }

  async function handleStartBoatOAuth(): Promise<void> {
    if (!startBoatOAuth) return;
    setBoatFeedback(null);
    try {
      await startBoatOAuth();
    } catch (cause) {
      setBoatFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not start Boat sign-in.",
      });
    }
  }

  async function handleCancelBoatOAuth(): Promise<void> {
    if (!cancelBoatOAuth) return;
    setBoatFeedback(null);
    try {
      await cancelBoatOAuth();
    } catch (cause) {
      setBoatFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not cancel Boat sign-in.",
      });
    }
  }

  async function handleSaveBoatApiKey(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!saveBoatApiKey) return;
    setBoatFeedback(null);
    try {
      await saveBoatApiKey(boatApiKey.trim());
      setBoatApiKey("");
      setShowBoatKeyForm(false);
      setBoatFeedback({
        kind: "info",
        text: "Verified and saved encrypted Boat API key.",
      });
    } catch (cause) {
      setBoatFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not save Boat API key.",
      });
    }
  }

  async function handleCreateBoatSandbox(): Promise<BoatSandboxSummary | null> {
    if (!createBoatSandbox) return null;
    setCreatingSandbox(true);
    setFormError("");
    try {
      const targetWorkspace = workspace.trim() || "/home/user";
      const created = await createBoatSandbox({
        name: newBoatSandboxName.trim() || undefined,
        type: newBoatSandboxSize,
        environment: newBoatSandboxEnvironment.trim() || undefined,
        workingDir: targetWorkspace,
      });
      setSelectedBoatSandboxId(created.id);
      setBoatMode("existing");
      setNewBoatSandboxName("");
      setNewBoatSandboxEnvironment("");
      if (!name.trim()) setName(created.name || created.id);
      if (!workspace.trim()) setWorkspace(targetWorkspace);
      syncBoatGuidedConfig(created.id, created.name ?? "", targetWorkspace);
      setFormNotice(`Boat sandbox "${created.name || created.id}" is ready.`);
      return created;
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Could not create Boat sandbox.");
      return null;
    } finally {
      setCreatingSandbox(false);
    }
  }

  async function handleBoatSandboxLifecycle(sandboxId: string, action: "stop" | "resume"): Promise<void> {
    setBoatSandboxActionId(sandboxId);
    setFormError("");
    try {
      if (action === "stop") {
        if (!stopBoatSandbox) return;
        await stopBoatSandbox(sandboxId);
        setFormNotice(`Stopped Boat sandbox "${sandboxId}".`);
      } else {
        if (!resumeBoatSandbox) return;
        const resumed = await resumeBoatSandbox(sandboxId);
        setFormNotice(`Resumed Boat sandbox "${resumed.name || resumed.id}".`);
      }
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : `Could not ${action} Boat sandbox.`);
    } finally {
      setBoatSandboxActionId(null);
    }
  }

  async function handleImportBlaxelCli(): Promise<void> {
    if (!importBlaxelCli) return;
    setCredentialFeedback(null);
    try {
      await importBlaxelCli(blaxelCli?.workspace ?? undefined);
      setShowBlaxelKeyForm(false);
      setCredentialFeedback({
        kind: "info",
        text: `Connected to Blaxel${blaxelCli?.workspace ? ` (${blaxelCli.workspace})` : ""} via Blaxel CLI and refreshed the engine.`,
      });
    } catch (cause) {
      setCredentialFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not import credentials from Blaxel CLI.",
      });
    }
  }

  async function handleSaveBlaxelKey(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!saveBlaxelCredentials) return;
    setCredentialFeedback(null);
    try {
      await saveBlaxelCredentials({
        apiKey: blaxelApiKey.trim(),
        workspace: blaxelWorkspaceInput.trim() || undefined,
      });
      setBlaxelApiKey("");
      setShowBlaxelKeyForm(false);
      setCredentialFeedback({
        kind: "info",
        text: "Saved encrypted Blaxel credentials and refreshed the engine.",
      });
    } catch (cause) {
      setCredentialFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not save Blaxel credentials.",
      });
    }
  }

  async function handleSaveTailscaleCredentials(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setTailscaleFeedback(null);
    try {
      if (tailscaleAuthMode === "oauth") {
        if (!saveTailscaleOAuth) return;
        await saveTailscaleOAuth({
          oauthClientId: tailscaleOAuthClientId.trim(),
          oauthClientSecret: tailscaleOAuthClientSecret.trim(),
          tags: tailscaleTagsInput.trim() || "tag:roder",
          tailnet: tailscaleTailnetInput.trim() || undefined,
          preferForSandboxes: true,
        });
        setTailscaleOAuthClientSecret("");
        setShowTailscaleForm(false);
        setTailscaleFeedback({
          kind: "info",
          text: "Verified and saved encrypted Tailscale OAuth client. Ephemeral keys will be auto-minted per sandbox.",
        });
      } else {
        if (!saveTailscaleAuthKey) return;
        await saveTailscaleAuthKey({
          authKey: tailscaleAuthKeyInput.trim(),
          preferForSandboxes: true,
        });
        setTailscaleAuthKeyInput("");
        setShowTailscaleForm(false);
        setTailscaleFeedback({
          kind: "info",
          text: "Saved encrypted Tailscale auth key for automatic sandbox tunneling.",
        });
      }
    } catch (cause) {
      setTailscaleFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not save Tailscale credentials.",
      });
    }
  }

  async function handleToggleTailscaleSandboxes(enabled: boolean): Promise<void> {
    if (!setTailscaleSandboxPreference) return;
    setTailscaleFeedback(null);
    try {
      await setTailscaleSandboxPreference(enabled);
      setTailscaleFeedback({
        kind: "info",
        text: enabled
          ? "Cloud sandboxes will automatically inject and tunnel over Tailscale."
          : "Cloud sandboxes will use provider preview tunnels unless opted in per machine.",
      });
    } catch (cause) {
      setTailscaleFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not update Tailscale preference.",
      });
    }
  }

  async function handleClearTailscaleCredentials(): Promise<void> {
    if (!clearProviderCredentials) return;
    setTailscaleFeedback(null);
    try {
      await clearProviderCredentials("tailscale");
      setTailscaleFeedback({
        kind: "info",
        text: "Cleared saved Tailscale sandbox credentials.",
      });
    } catch (cause) {
      setTailscaleFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not clear Tailscale credentials.",
      });
    }
  }

  async function handleClearCredentials(targetProviderId: string): Promise<void> {
    if (!clearProviderCredentials) return;
    setCredentialFeedback(null);
    try {
      await clearProviderCredentials(targetProviderId);
      setCredentialFeedback({
        kind: "info",
        text: `Disconnected ${targetProviderId} credentials.`,
      });
    } catch (cause) {
      setCredentialFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not disconnect credentials.",
      });
    }
  }

  async function handleSaveGenericToken(): Promise<void> {
    if (!selectedProvider || !providerTokenInput.trim() || !saveProviderToken) return;
    setCredentialFeedback(null);
    try {
      await saveProviderToken(selectedProvider.provider_id, providerTokenInput.trim());
      setProviderTokenInput("");
      setCredentialFeedback({
        kind: "info",
        text: `Saved encrypted ${selectedProvider.provider_id} credentials and refreshed the engine.`,
      });
    } catch (cause) {
      setCredentialFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "Could not save provider token.",
      });
    }
  }

  async function handleCreateSandbox(): Promise<string | null> {
    if (!createBlaxelSandbox) return null;
    const cleanName = newSandboxName.trim().toLowerCase();
    if (!cleanName) {
      setFormError("Enter a sandbox name (lowercase letters, numbers, and hyphens).");
      return null;
    }
    setCreatingSandbox(true);
    setFormError("");
    try {
      const targetWorkspace = workspace.trim() || "/workspace";
      const memory = Number.parseInt(newSandboxMemory.trim(), 10);
      const created = await createBlaxelSandbox({
        name: cleanName,
        workspace: effectiveBlaxelWorkspace || undefined,
        image: newSandboxImage.trim() || "blaxel/py-app:latest",
        memory: Number.isFinite(memory) && memory >= 512 ? memory : 4096,
        workingDir: targetWorkspace,
      });
      setSelectedSandboxName(created.name);
      setBlaxelMode("existing");
      setNewSandboxName("");
      if (!name.trim()) setName(created.name);
      if (!workspace.trim()) setWorkspace(targetWorkspace);
      syncBlaxelGuidedConfig(created.name, targetWorkspace);
      setFormNotice(`Sandbox "${created.name}" is deployed and ready.`);
      return created.name;
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Could not create Blaxel sandbox.");
      return null;
    } finally {
      setCreatingSandbox(false);
    }
  }

  async function addMachine(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError("");
    setFormNotice("");
    if (!cloudSupported) {
      setFormError(WINDOWS_CLOUD_MACHINES_NOTICE);
      return;
    }
    if (!selectedProvider) {
      setFormError("Select a runner provider first.");
      return;
    }

    let resolvedWorkspace = workspace.trim();
    let resolvedName = name.trim();
    let config: Record<string, unknown>;

    if (isBoatSelected) {
      if (!resolvedWorkspace) resolvedWorkspace = "/home/user";
      let sandboxId = selectedBoatSandboxId.trim();
      let sandboxName = selectedBoatSandbox?.name?.trim() || "";
      if (boatMode === "create") {
        const created = await handleCreateBoatSandbox();
        if (!created) return;
        sandboxId = created.id;
        sandboxName = created.name ?? "";
        if (!resolvedName) resolvedName = sandboxName || sandboxId;
      }
      if (!sandboxId) {
        try {
          const parsed: unknown = JSON.parse(configText);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const candidate = (parsed as Record<string, unknown>).sandbox_id;
            if (typeof candidate === "string" && candidate.trim()) {
              sandboxId = candidate.trim();
            }
          }
        } catch {
          // handled below
        }
      }
      if (!sandboxId) {
        setFormError("Choose an existing Boat sandbox, enter a Boat sandbox ID (bx_...), or create a new one.");
        return;
      }
      if (!resolvedName) resolvedName = sandboxName || sandboxId;

      try {
        const parsed: unknown = configText.trim() ? JSON.parse(configText) : {};
        const baseConfig =
          parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        config = validateMachineConfig({
          ...baseConfig,
          sandbox_id: sandboxId,
          ...(sandboxName ? { sandbox_name: sandboxName } : {}),
          working_dir: resolvedWorkspace,
          ...(tailscaleConfigured ? { tailscale_tunnel: boatTailscaleEnabled } : {}),
        });
      } catch {
        setFormError(
          "Enter a valid JSON object without credentials. Sign in with Boat in Connections instead of placing tokens in config.",
        );
        return;
      }
    } else if (isBlaxelSelected) {
      if (!resolvedWorkspace) resolvedWorkspace = "/workspace";
      let sandboxName = selectedSandboxName.trim();
      if (blaxelMode === "create") {
        const created = await handleCreateSandbox();
        if (!created) return;
        sandboxName = created;
        if (!resolvedName) resolvedName = created;
      }
      if (!sandboxName) {
        try {
          const parsed: unknown = JSON.parse(configText);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const candidate = (parsed as Record<string, unknown>).sandbox_name;
            if (typeof candidate === "string" && candidate.trim()) {
              sandboxName = candidate.trim();
            }
          }
        } catch {
          // handled below
        }
      }
      if (!sandboxName) {
        setFormError("Choose an existing Blaxel sandbox or create a new one.");
        return;
      }
      if (!resolvedName) resolvedName = sandboxName;

      try {
        const parsed: unknown = configText.trim() ? JSON.parse(configText) : {};
        const baseConfig =
          parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        config = validateMachineConfig({
          ...baseConfig,
          sandbox_name: sandboxName,
          working_dir: resolvedWorkspace,
          ...(effectiveBlaxelWorkspace && !baseConfig.workspace ? { workspace: effectiveBlaxelWorkspace } : {}),
          cleanup: typeof baseConfig.cleanup === "string" ? baseConfig.cleanup : "keep",
          ...(tailscaleConfigured ? { tailscale_tunnel: blaxelTailscaleEnabled } : {}),
        });
      } catch {
        setFormError(
          "Enter a valid JSON object without credentials. Supply secrets through the app-server environment.",
        );
        return;
      }
    } else if (isSshSelected) {
      const host = sshHost.trim();
      if (!host) {
        setFormError("Enter an SSH hostname, IP address, or ~/.ssh/config alias.");
        return;
      }
      if (!resolvedWorkspace) {
        setFormError("Enter the remote workspace path on that SSH server (e.g. /home/ubuntu/project).");
        return;
      }
      if (!resolvedName) {
        resolvedName = host.split(".")[0] || host;
      }
      const parsedPort = Number.parseInt(sshPort.trim(), 10);
      if (sshPort.trim() && (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535)) {
        setFormError("SSH port must be a number between 1 and 65535.");
        return;
      }
      try {
        const parsed: unknown = configText.trim() ? JSON.parse(configText) : {};
        const baseConfig =
          parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        config = validateMachineConfig({
          ...baseConfig,
          ssh_host: host,
          ...(sshUser.trim() ? { ssh_user: sshUser.trim() } : {}),
          ssh_port: Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 22,
          ...(sshIdentityFile.trim() ? { identity_file: sshIdentityFile.trim() } : {}),
          ...(sshProxyJump.trim() ? { proxy_jump: sshProxyJump.trim() } : {}),
          ...(tailscaleConfigured ? { tailscale_tunnel: sshTailscaleEnabled } : {}),
        });
      } catch {
        setFormError(
          "Enter a valid JSON object without credentials. Keep private keys on disk and reference their path only.",
        );
        return;
      }
    } else if (isTailscaleSelected) {
      const host = tailscalePeerHost.trim();
      const ip = tailscalePeerIp.trim();
      if (!host && !ip) {
        setFormError("Select a Tailscale peer or enter a Tailscale hostname / 100.x IP address.");
        return;
      }
      if (!resolvedWorkspace) {
        setFormError("Enter the remote workspace path on that Tailscale machine (e.g. /home/user/project).");
        return;
      }
      if (!resolvedName) {
        resolvedName = host.split(".")[0] || ip;
      }
      const parsedPort = Number.parseInt(tailscaleSshPort.trim(), 10);
      if (tailscaleSshPort.trim() && (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535)) {
        setFormError("SSH port must be a number between 1 and 65535.");
        return;
      }
      try {
        const parsed: unknown = configText.trim() ? JSON.parse(configText) : {};
        const baseConfig =
          parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        config = validateMachineConfig({
          ...baseConfig,
          ...(host ? { tailscale_host: host } : {}),
          ...(ip ? { tailscale_ip: ip } : {}),
          ...(tailscaleSshUser.trim() ? { ssh_user: tailscaleSshUser.trim() } : {}),
          ssh_port: Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 22,
        });
      } catch {
        setFormError(
          "Enter a valid JSON object without credentials. Supply secrets through the app-server environment.",
        );
        return;
      }
    } else {
      try {
        const parsed: unknown = JSON.parse(configText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setFormError("Provider configuration must be a JSON object.");
          return;
        }
        config = parsed as Record<string, unknown>;
        validateMachineConfig(config);
      } catch {
        setFormError(
          "Enter a valid JSON object without credentials. Supply secrets through the app-server environment.",
        );
        return;
      }
      if (!resolvedName || !resolvedWorkspace) {
        setFormError("Enter a name, select a provider, and enter the remote workspace path.");
        return;
      }
    }

    try {
      await save({
        ...(editingId ? { id: editingId } : {}),
        name: resolvedName,
        providerId: selectedProvider.provider_id,
        workspace: resolvedWorkspace,
        config,
        readRoots: readRoots
          .split("\n")
          .map((root) => root.trim())
          .filter(Boolean),
      });
      setFormNotice(editingId ? `Updated "${resolvedName}".` : `Saved "${resolvedName}".`);
      resetForm();
    } catch {
      setFormError("Could not save the machine. Check the connection and provider configuration, then try again.");
    }
  }

  async function startEditingMachine(id: string): Promise<void> {
    setFormError("");
    setFormNotice("");
    try {
      const { machine } = await roderIpc.getCloudMachineProfile(id);
      setEditingId(machine.id);
      openMachineForm();
      setName(machine.name);
      setProviderId(machine.providerId);
      setWorkspace(machine.workspace);
      setReadRoots((machine.readRoots ?? []).join("\n"));
      setConfigText(JSON.stringify(machine.config, null, 2));
      if (machine.providerId === "boat") {
        const sbxId = typeof machine.config.sandbox_id === "string" ? machine.config.sandbox_id : "";
        setSelectedBoatSandboxId(sbxId);
        setBoatTailscaleEnabled(machine.config.tailscale_tunnel !== false);
        setBoatMode("existing");
      } else if (machine.providerId === "blaxel") {
        const sbx = typeof machine.config.sandbox_name === "string" ? machine.config.sandbox_name : "";
        setSelectedSandboxName(sbx);
        setBlaxelTailscaleEnabled(machine.config.tailscale_tunnel !== false);
        setBlaxelMode("existing");
      } else if (machine.providerId === "ssh") {
        setSshHost(typeof machine.config.ssh_host === "string" ? machine.config.ssh_host : "");
        setSshUser(typeof machine.config.ssh_user === "string" ? machine.config.ssh_user : "");
        setSshPort(typeof machine.config.ssh_port === "number" ? String(machine.config.ssh_port) : "22");
        setSshIdentityFile(typeof machine.config.identity_file === "string" ? machine.config.identity_file : "");
        setSshProxyJump(typeof machine.config.proxy_jump === "string" ? machine.config.proxy_jump : "");
        setSshTailscaleEnabled(machine.config.tailscale_tunnel === true);
      } else if (machine.providerId === "tailscale") {
        setTailscalePeerHost(typeof machine.config.tailscale_host === "string" ? machine.config.tailscale_host : "");
        setTailscalePeerIp(typeof machine.config.tailscale_ip === "string" ? machine.config.tailscale_ip : "");
        setTailscaleSshUser(typeof machine.config.ssh_user === "string" ? machine.config.ssh_user : "");
        setTailscaleSshPort(typeof machine.config.ssh_port === "number" ? String(machine.config.ssh_port) : "22");
      }
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "Could not load machine profile.");
    }
  }

  async function testMachineConnection(id: string): Promise<void> {
    setTestingMachineId(id);
    setFormError("");
    try {
      const result = await roderIpc.testCloudMachine({ id });
      setTestResults((current) => ({ ...current, [id]: result }));
    } catch (cause) {
      setTestResults((current) => ({
        ...current,
        [id]: {
          ok: false,
          status: "ERROR",
          message: cause instanceof Error ? cause.message : "Connection test failed.",
        },
      }));
    } finally {
      setTestingMachineId(null);
    }
  }

  async function removeMachine(id: string): Promise<void> {
    setFormError("");
    try {
      await remove(id);
      if (editingId === id) resetForm();
      setPendingRemoval(null);
    } catch {
      setFormError("Could not remove the machine. Try again.");
    }
  }

  const canSubmit = isBoatSelected
    ? Boolean(selectedProvider && (boatMode === "create" ? boatConnected : selectedBoatSandboxId.trim()))
    : isBlaxelSelected
      ? Boolean(
          selectedProvider &&
          (blaxelMode === "create" ? newSandboxName.trim() : selectedSandboxName.trim() || name.trim()),
        )
      : isSshSelected
        ? Boolean(selectedProvider && sshHost.trim() && workspace.trim())
        : isTailscaleSelected
          ? Boolean(selectedProvider && (tailscalePeerHost.trim() || tailscalePeerIp.trim()) && workspace.trim())
          : Boolean(name.trim() && workspace.trim() && selectedProvider);

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-base font-medium">
            <Cloud className="size-4" />
            Cloud Machines
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            Connect remote sandboxes so agents, files, terminal, search, and git review work natively on remote
            machines.
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh().catch(() => {})}>
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
          Refresh
        </Button>
      </header>

      <nav aria-label="Cloud machine settings" className="flex gap-1 border-b border-border px-5 py-2">
        {(["machines", "connections"] as const).map((item) => (
          <Button
            key={item}
            type="button"
            size="sm"
            variant="ghost"
            className={cn(view === item && "bg-accent/60")}
            aria-pressed={view === item}
            onClick={() => setView(item)}
          >
            {item === "machines" ? "Machines" : "Connections"}
          </Button>
        ))}
      </nav>

      {((error && (credentialFeedback?.kind !== "error" || credentialFeedback.text !== error)) || formError) && (
        <div role="alert" className="border-b border-border px-5 py-3 text-base text-destructive">
          {formError || error}
        </div>
      )}

      {formNotice && (
        <div role="status" className="border-b border-border bg-muted/30 px-5 py-2.5 text-sm text-foreground">
          {formNotice}
        </div>
      )}

      {cloudSupported && (boatProviderAvailable || boatConnected || boatAuthInProgress) && (
        <div hidden={view !== "connections"} className="space-y-3 border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-medium">
                <Ship className="size-4 text-muted-foreground" />
                Boat
              </h2>
              <p className="mt-1 text-sm font-normal text-muted-foreground">
                Sign in with Boat to create and manage isolated cloud sandboxes with native agent execution, files, git
                review, SSH terminal, port hosting, and desktop streaming.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {boatConnected ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" />
                    Connected{boatAccountLabel ? ` · ${boatAccountLabel}` : ""}
                  </span>
                  {boatCredentials?.mode !== "oauth" && typeof startBoatOAuth === "function" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={savingCredentials || boatAuthInProgress}
                      onClick={() => void handleStartBoatOAuth()}
                    >
                      <Ship className="size-3.5" />
                      Sign in with Boat
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={savingCredentials}
                    onClick={() => setShowBoatKeyForm((open) => !open)}
                  >
                    {boatCredentials?.mode === "api-key" ? "Update key" : "Use API key"}
                  </Button>
                  {boatCredentials?.source !== "env" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={savingCredentials}
                      onClick={() => void handleClearCredentials("boat")}
                    >
                      <Unplug className="size-3.5" />
                      Sign out
                    </Button>
                  )}
                </>
              ) : boatAuthInProgress ? (
                <Button type="button" size="sm" variant="outline" onClick={() => void handleCancelBoatOAuth()}>
                  Cancel sign-in
                </Button>
              ) : (
                <>
                  {typeof startBoatOAuth === "function" && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingCredentials}
                      onClick={() => void handleStartBoatOAuth()}
                    >
                      <Ship className="size-3.5" />
                      Sign in with Boat
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={savingCredentials}
                    onClick={() => setShowBoatKeyForm((open) => !open)}
                  >
                    <KeyRound className="size-3.5" />
                    {showBoatKeyForm ? "Hide key form" : "Use API key"}
                  </Button>
                </>
              )}
            </div>
          </div>

          {boatAuthInProgress && boatAuthState && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/30 px-3.5 py-2.5 text-sm">
              <div className="flex items-center gap-2 text-foreground">
                <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
                <span>{boatAuthState.message || "Waiting for Boat sign-in in your browser…"}</span>
              </div>
              {boatAuthState.authUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void window.roderDesktop.openExternal(boatAuthState.authUrl!)}
                >
                  <ExternalLink className="size-3.5" />
                  Open Boat sign-in
                </Button>
              )}
            </div>
          )}

          {boatAuthState?.phase === "error" && boatAuthState.error && (
            <p role="alert" className="text-sm font-normal text-destructive">
              {boatAuthState.error}
            </p>
          )}

          {boatConnected && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-normal text-muted-foreground">
              <p>
                Auth:{" "}
                {boatCredentials?.mode === "oauth"
                  ? "Sign in with Boat (OAuth · encrypted)"
                  : boatCredentials?.source === "env"
                    ? "BOAT_API_KEY environment"
                    : "Saved Boat API key"}
                {boatCredentials?.preview ? (
                  <>
                    {" · "}
                    <span className="font-mono">{boatCredentials.preview}</span>
                  </>
                ) : null}
                {boatSandboxes.length > 0
                  ? ` · ${boatSandboxes.length} ${boatSandboxes.length === 1 ? "sandbox" : "sandboxes"} available`
                  : ""}
              </p>
              {boatProviderAvailable && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    applyProviderSelection("boat");
                    openMachineForm("name");
                  }}
                >
                  <Plus className="size-3.5" />
                  Add Boat sandbox
                </Button>
              )}
            </div>
          )}

          {boatFeedback && (
            <p
              role={boatFeedback.kind === "error" ? "alert" : "status"}
              className={cn(
                "text-sm font-normal",
                boatFeedback.kind === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {boatFeedback.text}
            </p>
          )}

          {showBoatKeyForm && (
            <form
              onSubmit={(event) => void handleSaveBoatApiKey(event)}
              className="grid gap-3 rounded-lg bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <label htmlFor={`${formId}-boat-key`} className="space-y-1 text-sm">
                <span className="text-muted-foreground">Boat API key</span>
                <input
                  id={`${formId}-boat-key`}
                  type="password"
                  className={cn(fieldClass, "font-mono")}
                  value={boatApiKey}
                  onChange={(event) => setBoatApiKey(event.currentTarget.value)}
                  placeholder="boat_..."
                  autoComplete="off"
                  required
                />
              </label>
              <div className="flex items-end">
                <Button type="submit" size="sm" disabled={savingCredentials || !boatApiKey.trim()}>
                  {savingCredentials ? "Verifying…" : "Connect"}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {cloudSupported && blaxelProviderAvailable && (
        <div hidden={view !== "connections"} className="space-y-3 border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-medium">
                <KeyRound className="size-4 text-muted-foreground" />
                Blaxel connection
              </h2>
              <p className="mt-1 text-sm font-normal text-muted-foreground">
                Credentials are encrypted in OS secure storage and injected automatically into the Roder engine and
                remote workspace tools.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {blaxelConnected ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" />
                    Connected{effectiveBlaxelWorkspace ? ` · ${effectiveBlaxelWorkspace}` : ""}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={savingCredentials}
                    onClick={() => setShowBlaxelKeyForm((open) => !open)}
                  >
                    Update key
                  </Button>
                  {blaxelCredential?.source !== "env" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={savingCredentials}
                      onClick={() => void handleClearCredentials("blaxel")}
                    >
                      <Unplug className="size-3.5" />
                      Disconnect
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {blaxelCli?.authenticated && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingCredentials}
                      onClick={() => void handleImportBlaxelCli()}
                    >
                      <Terminal className="size-3.5" />
                      {savingCredentials
                        ? "Connecting…"
                        : `Connect from Blaxel CLI${blaxelCli.workspace ? ` (${blaxelCli.workspace})` : ""}`}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={blaxelCli?.authenticated ? "outline" : "default"}
                    disabled={savingCredentials}
                    onClick={() => setShowBlaxelKeyForm((open) => !open)}
                  >
                    <KeyRound className="size-3.5" />
                    {showBlaxelKeyForm ? "Hide key form" : "Use API key"}
                  </Button>
                </>
              )}
            </div>
          </div>

          {blaxelConnected && blaxelCredential?.preview && (
            <p className="text-sm font-normal text-muted-foreground">
              Active key: <span className="font-mono">{blaxelCredential.preview}</span>
              {" · "}
              Source:{" "}
              {blaxelCredential.source === "blaxel-cli"
                ? "Imported from Blaxel CLI"
                : blaxelCredential.source === "env"
                  ? "Process environment"
                  : "Saved API key"}
              {blaxelSandboxes.length > 0 ? ` · ${blaxelSandboxes.length} sandboxes available` : ""}
            </p>
          )}

          {credentialFeedback && (
            <p
              role={credentialFeedback.kind === "error" ? "alert" : "status"}
              className={cn(
                "text-sm font-normal",
                credentialFeedback.kind === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {credentialFeedback.text}
            </p>
          )}

          {showBlaxelKeyForm && (
            <form
              onSubmit={(event) => void handleSaveBlaxelKey(event)}
              className="grid gap-3 rounded-lg bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto]"
            >
              <label htmlFor={`${formId}-blaxel-key`} className="space-y-1 text-sm">
                <span className="text-muted-foreground">Blaxel API key</span>
                <input
                  id={`${formId}-blaxel-key`}
                  type="password"
                  className={cn(fieldClass, "font-mono")}
                  value={blaxelApiKey}
                  onChange={(event) => setBlaxelApiKey(event.currentTarget.value)}
                  placeholder="bl_..."
                  autoComplete="off"
                  required
                />
              </label>
              <label htmlFor={`${formId}-blaxel-workspace`} className="space-y-1 text-sm">
                <span className="text-muted-foreground">Workspace (optional)</span>
                <input
                  id={`${formId}-blaxel-workspace`}
                  className={cn(fieldClass, "font-mono")}
                  value={blaxelWorkspaceInput}
                  onChange={(event) => setBlaxelWorkspaceInput(event.currentTarget.value)}
                  placeholder={effectiveBlaxelWorkspace || "auto-detect"}
                />
              </label>
              <div className="flex items-end">
                <Button type="submit" size="sm" disabled={savingCredentials || !blaxelApiKey.trim()}>
                  {savingCredentials ? "Saving…" : "Connect"}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {cloudSupported && (tailscaleProviderAvailable || localTailscale?.installed || tailscaleConfigured) && (
        <div hidden={view !== "connections"} className="space-y-3 border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-medium">
                <Network className="size-4 text-muted-foreground" />
                Tailscale tunnel
              </h2>
              <p className="mt-1 text-sm font-normal text-muted-foreground">
                Inject ephemeral Tailscale tunnels into cloud sandboxes and connect directly to your own tailnet
                machines over WireGuard.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {localTailscale?.running ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" />
                  Tailnet{localTailscale.magicDnsSuffix ? ` · ${localTailscale.magicDnsSuffix}` : " active"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1 text-sm font-medium text-muted-foreground">
                  {localTailscale?.installed ? "Tailscale stopped" : "Tailscale not detected"}
                </span>
              )}
              {refreshTailscale && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={savingCredentials}
                  onClick={() => void refreshTailscale()}
                >
                  <RefreshCw className="size-3.5" />
                  Scan peers
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={tailscaleConfigured ? "outline" : "default"}
                disabled={savingCredentials}
                onClick={() => setShowTailscaleForm((open) => !open)}
              >
                <ShieldCheck className="size-3.5" />
                {showTailscaleForm
                  ? "Hide setup"
                  : tailscaleConfigured
                    ? "Update tunnel auth"
                    : "Configure sandbox tunnel"}
              </Button>
              {tailscaleConfigured && tailscaleCredentials?.source !== "env" && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={savingCredentials}
                  onClick={() => void handleClearTailscaleCredentials()}
                >
                  <Unplug className="size-3.5" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {localTailscale?.running && localTailscale.self && (
            <p className="text-sm font-normal text-muted-foreground">
              This device:{" "}
              <span className="font-mono text-foreground">
                {localTailscale.self.dnsName || localTailscale.self.hostName}
              </span>{" "}
              (<span className="font-mono">{localTailscale.self.tailscaleIp}</span>){" · "}
              {onlineTailscalePeerCount}/{tailscalePeers.length} tailnet peers online
            </p>
          )}

          {tailscaleConfigured && tailscaleCredentials && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2.5 text-sm">
              <div className="space-y-0.5">
                <p className="text-foreground">
                  Sandbox auto-injection:{" "}
                  <span className="font-medium">
                    {tailscaleCredentials.mode === "oauth"
                      ? `OAuth auto-minting (${tailscaleCredentials.tags.join(", ") || "tag:roder"})`
                      : `Ephemeral auth key (${tailscaleCredentials.preview ?? "saved"})`}
                  </span>
                </p>
                <p className="font-normal text-muted-foreground">
                  {tailscaleCredentials.source === "env"
                    ? "Loaded from process environment"
                    : "Stored encrypted in OS secure storage"}
                </p>
              </div>
              {tailscaleCredentials.source !== "env" && typeof setTailscaleSandboxPreference === "function" && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={tailscaleCredentials.preferForSandboxes}
                    disabled={savingCredentials}
                    onChange={(event) => void handleToggleTailscaleSandboxes(event.currentTarget.checked)}
                    className="size-4 rounded border-input accent-primary"
                  />
                  <span>Prefer Tailscale for cloud sandboxes</span>
                </label>
              )}
            </div>
          )}

          {tailscaleFeedback && (
            <p
              role={tailscaleFeedback.kind === "error" ? "alert" : "status"}
              className={cn(
                "text-sm font-normal",
                tailscaleFeedback.kind === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {tailscaleFeedback.text}
            </p>
          )}

          {showTailscaleForm && (
            <form
              onSubmit={(event) => void handleSaveTailscaleCredentials(event)}
              className="space-y-3 rounded-lg bg-muted/30 p-3.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-lg bg-background p-0.5 ring-1 ring-border/70">
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                      tailscaleAuthMode === "oauth"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setTailscaleAuthMode("oauth")}
                  >
                    OAuth client (recommended)
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                      tailscaleAuthMode === "auth-key"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setTailscaleAuthMode("auth-key")}
                  >
                    Auth key
                  </button>
                </div>
                <span className="text-sm font-normal text-muted-foreground">
                  Encrypted in OS keyring · never stored in thread config
                </span>
              </div>

              {tailscaleAuthMode === "oauth" ? (
                <div className="space-y-3">
                  <p className="text-sm font-normal text-muted-foreground">
                    Create an OAuth client in Tailscale Admin → Settings → OAuth clients with{" "}
                    <span className="font-mono">auth_keys</span> write scope and a tag (e.g.{" "}
                    <span className="font-mono">tag:roder</span>). Roder Desktop auto-mints single-use ephemeral keys
                    for each sandbox.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label htmlFor={`${formId}-ts-oauth-id`} className="space-y-1 text-sm">
                      <span className="text-muted-foreground">OAuth client ID</span>
                      <input
                        id={`${formId}-ts-oauth-id`}
                        className={cn(fieldClass, "font-mono")}
                        value={tailscaleOAuthClientId}
                        onChange={(event) => setTailscaleOAuthClientId(event.currentTarget.value)}
                        placeholder={tailscaleCredentials?.oauthClientId || "k123456CNTRL"}
                        autoComplete="off"
                        required
                      />
                    </label>
                    <label htmlFor={`${formId}-ts-oauth-secret`} className="space-y-1 text-sm">
                      <span className="text-muted-foreground">OAuth client secret</span>
                      <input
                        id={`${formId}-ts-oauth-secret`}
                        type="password"
                        className={cn(fieldClass, "font-mono")}
                        value={tailscaleOAuthClientSecret}
                        onChange={(event) => setTailscaleOAuthClientSecret(event.currentTarget.value)}
                        placeholder="tskey-client-..."
                        autoComplete="off"
                        required
                      />
                    </label>
                    <label htmlFor={`${formId}-ts-tags`} className="space-y-1 text-sm">
                      <span className="text-muted-foreground">Node tag(s)</span>
                      <input
                        id={`${formId}-ts-tags`}
                        className={cn(fieldClass, "font-mono")}
                        value={tailscaleTagsInput}
                        onChange={(event) => setTailscaleTagsInput(event.currentTarget.value)}
                        placeholder="tag:roder"
                        required
                      />
                    </label>
                    <label htmlFor={`${formId}-ts-tailnet`} className="space-y-1 text-sm">
                      <span className="text-muted-foreground">Tailnet (optional)</span>
                      <input
                        id={`${formId}-ts-tailnet`}
                        className={cn(fieldClass, "font-mono")}
                        value={tailscaleTailnetInput}
                        onChange={(event) => setTailscaleTailnetInput(event.currentTarget.value)}
                        placeholder={localTailscale?.tailnetName || "- (default)"}
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-normal text-muted-foreground">
                    Paste a reusable, ephemeral, pre-authorized key from Tailscale Admin → Settings → Keys.
                  </p>
                  <label htmlFor={`${formId}-ts-authkey`} className="block space-y-1 text-sm">
                    <span className="text-muted-foreground">Tailscale auth key</span>
                    <input
                      id={`${formId}-ts-authkey`}
                      type="password"
                      className={cn(fieldClass, "font-mono")}
                      value={tailscaleAuthKeyInput}
                      onChange={(event) => setTailscaleAuthKeyInput(event.currentTarget.value)}
                      placeholder="tskey-auth-..."
                      autoComplete="off"
                      required
                    />
                  </label>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    savingCredentials ||
                    (tailscaleAuthMode === "oauth"
                      ? !tailscaleOAuthClientId.trim() || !tailscaleOAuthClientSecret.trim()
                      : !tailscaleAuthKeyInput.trim())
                  }
                >
                  {savingCredentials
                    ? "Verifying…"
                    : tailscaleAuthMode === "oauth"
                      ? "Verify & save OAuth client"
                      : "Save auth key"}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {cloudSupported && (sshProviderAvailable || localSsh?.installed) && (
        <div hidden={view !== "connections"} className="space-y-3 border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-medium">
                <Server className="size-4 text-muted-foreground" />
                SSH servers
              </h2>
              <p className="mt-1 text-sm font-normal text-muted-foreground">
                Connect to any macOS or Linux machine over SSH using your local{" "}
                <span className="font-mono">~/.ssh/config</span> or SSH keys, with automatic{" "}
                <span className="font-mono">remote-roder</span> tunneling and optional Tailscale injection.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {localSsh?.installed ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" />
                  OpenSSH ready
                  {sshConfigHosts.length > 0
                    ? ` · ${sshConfigHosts.length} ${sshConfigHosts.length === 1 ? "host" : "hosts"}`
                    : ""}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1 text-sm font-medium text-muted-foreground">
                  SSH client ready on macOS/Linux
                </span>
              )}
              {typeof refreshSsh === "function" && (
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void refreshSsh()}>
                  <RefreshCw className="size-3.5" />
                  Scan ~/.ssh
                </Button>
              )}
              {sshProviderAvailable && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    applyProviderSelection("ssh");
                    openMachineForm("ssh-quick");
                  }}
                >
                  <Plus className="size-3.5" />
                  Add SSH server
                </Button>
              )}
            </div>
          </div>

          {(sshConfigHosts.length > 0 || sshIdentityFiles.length > 0) && (
            <div className="space-y-2 rounded-lg bg-muted/30 p-3 text-sm">
              {sshIdentityFiles.length > 0 && (
                <p className="font-normal text-muted-foreground">
                  Detected SSH keys ({sshIdentityFiles.length}):{" "}
                  <span className="font-mono text-foreground">{sshIdentityFiles.slice(0, 4).join(", ")}</span>
                  {sshIdentityFiles.length > 4 ? ` +${sshIdentityFiles.length - 4} more` : ""}
                </p>
              )}
              {sshConfigHosts.length > 0 && (
                <div className="space-y-1.5">
                  <p className="font-normal text-muted-foreground">Hosts in ~/.ssh/config (click to configure):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sshConfigHosts.map((hostEntry) => (
                      <Button
                        key={hostEntry.alias}
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-md font-mono text-sm"
                        onClick={() => importSshConfigHost(hostEntry)}
                      >
                        <Server className="size-3" />
                        <span>{hostEntry.alias}</span>
                        {hostEntry.hostName !== hostEntry.alias && (
                          <span className="text-muted-foreground">({hostEntry.hostName})</span>
                        )}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div hidden={view !== "connections"} className="px-5 py-4">
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-3 text-base font-medium">Manage runner providers</summary>
          <div className="space-y-3 border-t border-border p-3">
            <p className="text-sm text-muted-foreground">
              Sign-in and credential management are not available here. Set credentials in the app-server environment;
              provider availability does not confirm authentication or connectivity.
            </p>
            {providers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {busy ? "Loading remote runner providers..." : "Refresh to discover available runner providers."}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {providers.map((provider) => {
                  const help = machineProviderHelp(provider.provider_id);
                  return (
                    <li key={provider.provider_id} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-base font-medium">{provider.provider_id}</h3>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!cloudSupported || busy || (configText.trim() !== "{}" && configText.trim() !== "")}
                          onClick={() => {
                            applyProviderSelection(provider.provider_id);
                            openMachineForm();
                            document.getElementById(`${formId}-provider`)?.focus();
                          }}
                        >
                          Configure machine
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground">{help.description}</p>
                      {provider.setup_hint && (
                        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                          {provider.setup_hint}
                        </p>
                      )}
                      {help.environment.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                          App-server environment: <span className="font-mono">{help.environment.join(", ")}</span>
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {configText.trim() !== "{}" && configText.trim() !== "" && (
              <p className="text-sm text-muted-foreground">
                Clear the current machine configuration before selecting another provider here.
              </p>
            )}
          </div>
        </details>
      </div>

      <div hidden={view !== "machines"} className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">
              Saved machines <span className="ml-1 text-sm text-muted-foreground">{machines.length}</span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Profiles apply to new threads only. Removing a profile does not stop or delete the remote machine.
            </p>
          </div>
          {!showMachineForm && (
            <Button type="button" size="sm" disabled={!cloudSupported || busy} onClick={() => openMachineForm()}>
              <Plus className="size-3.5" />
              Add machine
            </Button>
          )}
        </div>
        {machines.length === 0 ? (
          <div className="flex gap-3 rounded-xl border border-dashed border-border p-4">
            <Cloud className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-base font-medium">No cloud machines configured.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a machine to run new threads remotely, or keep running threads locally.
              </p>
              {cloudSupported && (
                <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setView("connections")}>
                  Manage connections
                </Button>
              )}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {machines.map((machine) => {
              const supported = providers.some((provider) => provider.provider_id === machine.providerId);
              const testResult = testResults[machine.id];
              return (
                <li key={machine.id} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {machine.providerId === "tailscale" ? (
                      <Network className="size-4 shrink-0 text-muted-foreground" />
                    ) : machine.providerId === "ssh" ? (
                      <Server className="size-4 shrink-0 text-muted-foreground" />
                    ) : machine.providerId === "boat" ? (
                      <Ship className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Cloud className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-base font-medium">{machine.name}</div>
                      <div className="break-all font-mono text-sm text-muted-foreground">
                        {machine.providerId} &middot; {machine.workspace}
                      </div>
                      {!supported && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Provider unavailable in the current runtime. Refresh providers or use another profile.
                        </p>
                      )}
                    </div>
                    {pendingRemoval === machine.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">Remove profile?</span>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setPendingRemoval(null)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="warning"
                          disabled={busy}
                          onClick={() => void removeMachine(machine.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {(machine.providerId === "boat" ||
                          machine.providerId === "blaxel" ||
                          machine.providerId === "tailscale" ||
                          machine.providerId === "ssh") &&
                          cloudSupported && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={busy || testingMachineId === machine.id}
                              onClick={() => void testMachineConnection(machine.id)}
                            >
                              <PlugZap className="size-3.5" />
                              {testingMachineId === machine.id ? "Testing…" : "Test"}
                            </Button>
                          )}
                        {cloudSupported && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            aria-label={`Edit ${machine.name}`}
                            onClick={() => void startEditingMachine(machine.id)}
                          >
                            <Pencil className="size-3.5" />
                            Edit
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          aria-label={`Remove ${machine.name}`}
                          onClick={() => setPendingRemoval(machine.id)}
                        >
                          <Trash2 className="size-3.5" />
                          Remove
                        </Button>
                      </div>
                    )}
                  </div>
                  {testResult && (
                    <p
                      role={testResult.ok ? "status" : "alert"}
                      className={cn(
                        "rounded-md px-2.5 py-1.5 text-sm font-normal",
                        testResult.ok
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {testResult.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!cloudSupported && (
        <p className="px-5 pb-4 text-base text-muted-foreground" role="status">
          {WINDOWS_CLOUD_MACHINES_NOTICE}
        </p>
      )}
      <form
        id={`${formId}-editor`}
        hidden={view !== "machines" || !showMachineForm}
        onSubmit={(event) => void addMachine(event)}
        className="space-y-4 border-t border-border px-5 py-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-medium">{editingId ? "Edit cloud machine" : "Add a cloud machine"}</h2>
          <Button type="button" size="sm" variant="ghost" disabled={busy || creatingSandbox} onClick={resetForm}>
            Cancel
          </Button>
        </div>
        {providers.length === 0 && (
          <p className="text-base text-muted-foreground" role="status">
            {busy
              ? "Loading remote runner providers..."
              : "No remote runner providers available. Connect to the app-server and refresh to discover supported providers."}
          </p>
        )}
        <fieldset disabled={!cloudSupported || busy || providers.length === 0} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label htmlFor={`${formId}-name`} className="space-y-1.5 text-base">
              <span>Machine name</span>
              <input
                id={`${formId}-name`}
                className={fieldClass}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder={
                  isBoatSelected
                    ? "my-boat-dev"
                    : isBlaxelSelected
                      ? "roder-remote-dev"
                      : isSshSelected
                        ? "hetzner-prod"
                        : isTailscaleSelected
                          ? "devbox"
                          : "Development sandbox"
                }
                required={!isBoatSelected && !isBlaxelSelected && !isTailscaleSelected && !isSshSelected}
              />
            </label>
            <label htmlFor={`${formId}-provider`} className="space-y-1.5 text-base">
              <span>Runner provider</span>
              <select
                id={`${formId}-provider`}
                className={fieldClass}
                value={selectedProvider?.provider_id ?? ""}
                onChange={(event) => applyProviderSelection(event.currentTarget.value)}
              >
                {providers.map((provider) => (
                  <option key={provider.provider_id} value={provider.provider_id}>
                    {provider.provider_id}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {isBoatSelected ? (
            <div className="space-y-3 rounded-xl bg-muted/30 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-lg bg-background p-0.5 ring-1 ring-border/70">
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                      boatMode === "existing"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setBoatMode("existing")}
                  >
                    Existing sandbox
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                      boatMode === "create"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setBoatMode("create")}
                  >
                    Create new sandbox
                  </button>
                </div>
                {boatConnected && typeof refreshBoatSandboxes === "function" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={loadingSandboxes}
                    onClick={() => void refreshBoatSandboxes()}
                  >
                    <RefreshCw className={cn("size-3.5", loadingSandboxes && "animate-spin")} />
                    {loadingSandboxes ? "Loading…" : "Reload sandboxes"}
                  </Button>
                )}
              </div>

              {!boatConnected && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background px-3 py-2.5 ring-1 ring-border/70">
                  <p className="text-sm font-normal text-muted-foreground">
                    Sign in with Boat to browse and provision sandboxes directly.
                  </p>
                  {typeof startBoatOAuth === "function" && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingCredentials || boatAuthInProgress}
                      onClick={() => {
                        setView("connections");
                        void handleStartBoatOAuth();
                      }}
                    >
                      <Ship className="size-3.5" />
                      {boatAuthInProgress ? "Signing in…" : "Sign in with Boat"}
                    </Button>
                  )}
                </div>
              )}

              {boatMode === "existing" ? (
                <div className="space-y-2.5">
                  {boatSandboxes.length > 0 ? (
                    <div className="space-y-2">
                      <label htmlFor={`${formId}-boat-sandbox-select`} className="block space-y-1.5 text-base">
                        <span>Boat sandbox</span>
                        <select
                          id={`${formId}-boat-sandbox-select`}
                          className={cn(fieldClass, "font-mono")}
                          value={selectedBoatSandboxId}
                          onChange={(event) => {
                            const nextId = event.currentTarget.value;
                            const picked = boatSandboxes.find((entry) => entry.id === nextId);
                            setSelectedBoatSandboxId(nextId);
                            if (!name.trim() && (picked?.name || nextId)) setName(picked?.name || nextId);
                            const nextWorkspace = workspace.trim() || "/home/user";
                            if (!workspace.trim()) setWorkspace(nextWorkspace);
                            syncBoatGuidedConfig(nextId, picked?.name ?? "", nextWorkspace);
                          }}
                        >
                          <option value="">Choose a Boat sandbox…</option>
                          {boatSandboxes.map((sandbox) => (
                            <option key={sandbox.id} value={sandbox.id}>
                              {sandbox.name ? `${sandbox.name} (${sandbox.id})` : sandbox.id}
                              {sandbox.state ? ` · ${sandbox.state.toLowerCase()}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      {selectedBoatSandbox && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                          <span>
                            State: <span className="font-mono text-foreground">{selectedBoatSandbox.state}</span>
                            {selectedBoatSandbox.desktopAvailable ? " · Desktop available" : ""}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {selectedBoatSandbox.state.toLowerCase() === "stopped" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={boatSandboxActionId === selectedBoatSandbox.id}
                                onClick={() => void handleBoatSandboxLifecycle(selectedBoatSandbox.id, "resume")}
                              >
                                <Play className="size-3.5" />
                                {boatSandboxActionId === selectedBoatSandbox.id ? "Resuming…" : "Resume"}
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={boatSandboxActionId === selectedBoatSandbox.id}
                                onClick={() => void handleBoatSandboxLifecycle(selectedBoatSandbox.id, "stop")}
                              >
                                <Square className="size-3.5" />
                                {boatSandboxActionId === selectedBoatSandbox.id ? "Stopping…" : "Stop"}
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <label htmlFor={`${formId}-boat-sandbox-manual`} className="block space-y-1.5 text-base">
                      <span>Boat sandbox ID</span>
                      <input
                        id={`${formId}-boat-sandbox-manual`}
                        className={cn(fieldClass, "font-mono")}
                        value={selectedBoatSandboxId}
                        onChange={(event) => {
                          const nextId = event.currentTarget.value;
                          setSelectedBoatSandboxId(nextId);
                          const nextWorkspace = workspace.trim() || "/home/user";
                          syncBoatGuidedConfig(nextId, "", nextWorkspace);
                        }}
                        placeholder="bx_abc123def456"
                      />
                    </label>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <label htmlFor={`${formId}-new-boat-name`} className="space-y-1.5 text-base">
                    <span>Sandbox name (optional)</span>
                    <input
                      id={`${formId}-new-boat-name`}
                      className={cn(fieldClass, "font-mono")}
                      value={newBoatSandboxName}
                      onChange={(event) => {
                        const next = event.currentTarget.value;
                        setNewBoatSandboxName(next);
                        if (!name.trim() || name === newBoatSandboxName) {
                          setName(next);
                        }
                        if (!workspace.trim()) setWorkspace("/home/user");
                      }}
                      placeholder="roder-boat-dev"
                    />
                  </label>
                  <label htmlFor={`${formId}-new-boat-size`} className="space-y-1.5 text-base">
                    <span>Size</span>
                    <select
                      id={`${formId}-new-boat-size`}
                      className={fieldClass}
                      value={newBoatSandboxSize}
                      onChange={(event) => setNewBoatSandboxSize(event.currentTarget.value as BoatSandboxSize)}
                    >
                      <option value="small">small</option>
                      <option value="default">default (4 vCPU · 8 GB)</option>
                      <option value="large">large</option>
                      <option value="xlarge">xlarge</option>
                    </select>
                  </label>
                  <label htmlFor={`${formId}-new-boat-env`} className="space-y-1.5 text-base">
                    <span>Environment (optional)</span>
                    <input
                      id={`${formId}-new-boat-env`}
                      className={cn(fieldClass, "font-mono")}
                      value={newBoatSandboxEnvironment}
                      onChange={(event) => setNewBoatSandboxEnvironment(event.currentTarget.value)}
                      placeholder="base"
                    />
                  </label>
                </div>
              )}

              {tailscaleConfigured && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={boatTailscaleEnabled}
                    onChange={(event) => {
                      const nextEnabled = event.currentTarget.checked;
                      setBoatTailscaleEnabled(nextEnabled);
                      if (selectedBoatSandboxId) {
                        syncBoatGuidedConfig(
                          selectedBoatSandboxId,
                          selectedBoatSandbox?.name ?? "",
                          workspace,
                          nextEnabled,
                        );
                      }
                    }}
                    className="size-4 rounded border-input accent-primary"
                  />
                  <span>Inject ephemeral Tailscale WireGuard tunnel into this Boat sandbox</span>
                </label>
              )}
            </div>
          ) : isBlaxelSelected ? (
            <div className="space-y-3 rounded-xl bg-muted/30 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-lg bg-background p-0.5 ring-1 ring-border/70">
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                      blaxelMode === "existing"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setBlaxelMode("existing")}
                  >
                    Existing sandbox
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                      blaxelMode === "create"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setBlaxelMode("create")}
                  >
                    Create new sandbox
                  </button>
                </div>
                {blaxelConnected && refreshBlaxelSandboxes && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={loadingSandboxes}
                    onClick={() => void refreshBlaxelSandboxes(effectiveBlaxelWorkspace || undefined)}
                  >
                    <RefreshCw className={cn("size-3.5", loadingSandboxes && "animate-spin")} />
                    {loadingSandboxes ? "Loading…" : "Reload sandboxes"}
                  </Button>
                )}
              </div>

              {!blaxelConnected && (
                <p className="text-sm font-normal text-muted-foreground">
                  Connect Blaxel above to browse and provision sandboxes directly, or enter a sandbox name manually.
                </p>
              )}

              {blaxelMode === "existing" ? (
                <div className="space-y-2">
                  {blaxelSandboxes.length > 0 ? (
                    <label htmlFor={`${formId}-blaxel-sandbox-select`} className="block space-y-1.5 text-base">
                      <span>Blaxel sandbox</span>
                      <select
                        id={`${formId}-blaxel-sandbox-select`}
                        className={cn(fieldClass, "font-mono")}
                        value={selectedSandboxName}
                        onChange={(event) => {
                          const nextSandbox = event.currentTarget.value;
                          setSelectedSandboxName(nextSandbox);
                          if (!name.trim() && nextSandbox) setName(nextSandbox);
                          const nextWorkspace = workspace.trim() || "/workspace";
                          if (!workspace.trim()) setWorkspace(nextWorkspace);
                          syncBlaxelGuidedConfig(nextSandbox, nextWorkspace);
                        }}
                      >
                        <option value="">Choose a sandbox…</option>
                        {blaxelSandboxes.map((sandbox) => (
                          <option key={sandbox.name} value={sandbox.name}>
                            {sandbox.name}
                            {sandbox.region ? ` (${sandbox.region})` : ""}
                            {sandbox.status ? ` · ${sandbox.status.toLowerCase()}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label htmlFor={`${formId}-blaxel-sandbox-manual`} className="block space-y-1.5 text-base">
                      <span>Blaxel sandbox name</span>
                      <input
                        id={`${formId}-blaxel-sandbox-manual`}
                        className={cn(fieldClass, "font-mono")}
                        value={selectedSandboxName}
                        onChange={(event) => {
                          const nextSandbox = event.currentTarget.value;
                          setSelectedSandboxName(nextSandbox);
                          const nextWorkspace = workspace.trim() || "/workspace";
                          syncBlaxelGuidedConfig(nextSandbox, nextWorkspace);
                        }}
                        placeholder="my-dev-sandbox"
                      />
                    </label>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <label htmlFor={`${formId}-new-sandbox-name`} className="space-y-1.5 text-base">
                    <span>New sandbox name</span>
                    <input
                      id={`${formId}-new-sandbox-name`}
                      className={cn(fieldClass, "font-mono")}
                      value={newSandboxName}
                      onChange={(event) => {
                        const next = event.currentTarget.value;
                        setNewSandboxName(next);
                        if (!name.trim() || name === newSandboxName) {
                          setName(next);
                        }
                        if (!workspace.trim()) setWorkspace("/workspace");
                      }}
                      placeholder="roder-remote-dev"
                    />
                  </label>
                  <label htmlFor={`${formId}-new-sandbox-image`} className="space-y-1.5 text-base">
                    <span>Image</span>
                    <input
                      id={`${formId}-new-sandbox-image`}
                      className={cn(fieldClass, "font-mono")}
                      value={newSandboxImage}
                      onChange={(event) => setNewSandboxImage(event.currentTarget.value)}
                      placeholder="blaxel/py-app:latest"
                    />
                  </label>
                  <label htmlFor={`${formId}-new-sandbox-memory`} className="space-y-1.5 text-base">
                    <span>Memory (MB)</span>
                    <input
                      id={`${formId}-new-sandbox-memory`}
                      type="number"
                      min={512}
                      step={512}
                      className={cn(fieldClass, "font-mono")}
                      value={newSandboxMemory}
                      onChange={(event) => setNewSandboxMemory(event.currentTarget.value)}
                    />
                  </label>
                </div>
              )}

              {blaxelWorkspaces.length > 1 && (
                <p className="text-sm font-normal text-muted-foreground">
                  Active Blaxel workspace: <span className="font-mono">{effectiveBlaxelWorkspace}</span>
                </p>
              )}

              {tailscaleConfigured && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={blaxelTailscaleEnabled}
                    onChange={(event) => {
                      const nextEnabled = event.currentTarget.checked;
                      setBlaxelTailscaleEnabled(nextEnabled);
                      if (selectedSandboxName) {
                        syncBlaxelGuidedConfig(selectedSandboxName, workspace, nextEnabled);
                      }
                    }}
                    className="size-4 rounded border-input accent-primary"
                  />
                  <span>Inject ephemeral Tailscale WireGuard tunnel into this sandbox</span>
                </label>
              )}
            </div>
          ) : isSshSelected ? (
            <div className="space-y-3 rounded-xl bg-muted/30 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-normal text-muted-foreground">
                  Paste an SSH target (<span className="font-mono">user@host:port</span> or{" "}
                  <span className="font-mono">ssh -i ~/.ssh/key user@host</span>) or pick from{" "}
                  <span className="font-mono">~/.ssh/config</span>. Works on macOS and Linux.
                </p>
                {typeof refreshSsh === "function" && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => void refreshSsh()}>
                    <RefreshCw className="size-3.5" />
                    Reload ~/.ssh
                  </Button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label htmlFor={`${formId}-ssh-quick`} className="space-y-1.5 text-base">
                  <span>Quick paste (optional)</span>
                  <input
                    id={`${formId}-ssh-quick`}
                    className={cn(fieldClass, "font-mono")}
                    spellCheck={false}
                    value={sshQuickTarget}
                    onChange={(event) => {
                      const raw = event.currentTarget.value;
                      const prevDerivedName = sshHost.split(".")[0] || sshHost;
                      setSshQuickTarget(raw);
                      const trimmedRaw = raw.trim();
                      if (trimmedRaw === "s" || trimmedRaw === "ss" || trimmedRaw === "ssh") {
                        return;
                      }
                      const parsed = parseQuickSshInput(raw);
                      if (parsed.host) {
                        const nextUser = parsed.user ?? sshUser;
                        const nextPort = parsed.port ? String(parsed.port) : sshPort;
                        const nextKey = parsed.identityFile ?? sshIdentityFile;
                        const nextJump = parsed.proxyJump ?? sshProxyJump;
                        const nextDerivedName = parsed.host.split(".")[0] || parsed.host;
                        setSshHost(parsed.host);
                        if (parsed.user !== undefined) setSshUser(parsed.user);
                        if (parsed.port !== undefined) setSshPort(String(parsed.port));
                        if (parsed.identityFile !== undefined) setSshIdentityFile(parsed.identityFile);
                        if (parsed.proxyJump !== undefined) setSshProxyJump(parsed.proxyJump);
                        if (!name.trim() || name === prevDerivedName) {
                          setName(nextDerivedName);
                        }
                        syncSshGuidedConfig({
                          host: parsed.host,
                          user: nextUser,
                          port: nextPort,
                          identityFile: nextKey,
                          proxyJump: nextJump,
                          tailscaleTunnel: sshTailscaleEnabled,
                        });
                      }
                    }}
                    placeholder="ssh -p 22 ubuntu@dev.example.com"
                  />
                </label>

                {sshConfigHosts.length > 0 && (
                  <label htmlFor={`${formId}-ssh-config-select`} className="space-y-1.5 text-base">
                    <span>From ~/.ssh/config</span>
                    <select
                      id={`${formId}-ssh-config-select`}
                      className={cn(fieldClass, "font-mono")}
                      value={sshConfigHosts.some((entry) => entry.alias === sshHost) ? sshHost : ""}
                      onChange={(event) => {
                        const selected = sshConfigHosts.find((entry) => entry.alias === event.currentTarget.value);
                        if (selected) importSshConfigHost(selected);
                      }}
                    >
                      <option value="">Choose a host alias…</option>
                      {sshConfigHosts.map((entry) => (
                        <option key={entry.alias} value={entry.alias}>
                          {entry.alias}
                          {entry.hostName !== entry.alias ? ` (${entry.hostName})` : ""}
                          {entry.user ? ` · ${entry.user}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label htmlFor={`${formId}-ssh-host`} className="space-y-1.5 text-base sm:col-span-1">
                  <span>Host or alias</span>
                  <input
                    id={`${formId}-ssh-host`}
                    className={cn(fieldClass, "font-mono")}
                    value={sshHost}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setSshHost(next);
                      syncSshGuidedConfig({
                        host: next,
                        user: sshUser,
                        port: sshPort,
                        identityFile: sshIdentityFile,
                        proxyJump: sshProxyJump,
                        tailscaleTunnel: sshTailscaleEnabled,
                      });
                    }}
                    placeholder="dev.example.com"
                  />
                </label>
                <label htmlFor={`${formId}-ssh-user`} className="space-y-1.5 text-base">
                  <span>Username (optional)</span>
                  <input
                    id={`${formId}-ssh-user`}
                    className={cn(fieldClass, "font-mono")}
                    value={sshUser}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setSshUser(next);
                      syncSshGuidedConfig({
                        host: sshHost,
                        user: next,
                        port: sshPort,
                        identityFile: sshIdentityFile,
                        proxyJump: sshProxyJump,
                        tailscaleTunnel: sshTailscaleEnabled,
                      });
                    }}
                    placeholder="ubuntu"
                  />
                </label>
                <label htmlFor={`${formId}-ssh-port`} className="space-y-1.5 text-base">
                  <span>Port</span>
                  <input
                    id={`${formId}-ssh-port`}
                    type="number"
                    min={1}
                    max={65535}
                    className={cn(fieldClass, "font-mono")}
                    value={sshPort}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setSshPort(next);
                      syncSshGuidedConfig({
                        host: sshHost,
                        user: sshUser,
                        port: next,
                        identityFile: sshIdentityFile,
                        proxyJump: sshProxyJump,
                        tailscaleTunnel: sshTailscaleEnabled,
                      });
                    }}
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label htmlFor={`${formId}-ssh-key`} className="space-y-1.5 text-base">
                  <span>Identity key path (optional)</span>
                  <input
                    id={`${formId}-ssh-key`}
                    list={sshIdentityFiles.length > 0 ? `${formId}-ssh-keys-list` : undefined}
                    className={cn(fieldClass, "font-mono")}
                    value={sshIdentityFile}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setSshIdentityFile(next);
                      syncSshGuidedConfig({
                        host: sshHost,
                        user: sshUser,
                        port: sshPort,
                        identityFile: next,
                        proxyJump: sshProxyJump,
                        tailscaleTunnel: sshTailscaleEnabled,
                      });
                    }}
                    placeholder="~/.ssh/id_ed25519 (default agent/config)"
                  />
                  {sshIdentityFiles.length > 0 && (
                    <datalist id={`${formId}-ssh-keys-list`}>
                      {sshIdentityFiles.map((keyPath) => (
                        <option key={keyPath} value={keyPath}>
                          {keyPath}
                        </option>
                      ))}
                    </datalist>
                  )}
                </label>
                <label htmlFor={`${formId}-ssh-jump`} className="space-y-1.5 text-base">
                  <span>ProxyJump / bastion (optional)</span>
                  <input
                    id={`${formId}-ssh-jump`}
                    className={cn(fieldClass, "font-mono")}
                    value={sshProxyJump}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setSshProxyJump(next);
                      syncSshGuidedConfig({
                        host: sshHost,
                        user: sshUser,
                        port: sshPort,
                        identityFile: sshIdentityFile,
                        proxyJump: next,
                        tailscaleTunnel: sshTailscaleEnabled,
                      });
                    }}
                    placeholder="bastion@jump.example.com"
                  />
                </label>
              </div>

              {tailscaleConfigured && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={sshTailscaleEnabled}
                    onChange={(event) => {
                      const nextEnabled = event.currentTarget.checked;
                      setSshTailscaleEnabled(nextEnabled);
                      syncSshGuidedConfig({
                        host: sshHost,
                        user: sshUser,
                        port: sshPort,
                        identityFile: sshIdentityFile,
                        proxyJump: sshProxyJump,
                        tailscaleTunnel: nextEnabled,
                      });
                    }}
                    className="size-4 rounded border-input accent-primary"
                  />
                  <span>Inject ephemeral Tailscale WireGuard tunnel on this SSH server</span>
                </label>
              )}
            </div>
          ) : isTailscaleSelected ? (
            <div className="space-y-3 rounded-xl bg-muted/30 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-normal text-muted-foreground">
                  Pick any machine on your tailnet to run agents, files, review, and interactive terminal directly over
                  Tailscale SSH / <span className="font-mono">remote-roder</span>.
                </p>
                {refreshTailscale && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => void refreshTailscale()}>
                    <RefreshCw className="size-3.5" />
                    Reload peers
                  </Button>
                )}
              </div>

              {tailscalePeers.length > 0 && (
                <label htmlFor={`${formId}-tailscale-peer-select`} className="block space-y-1.5 text-base">
                  <span>Tailscale peer</span>
                  <select
                    id={`${formId}-tailscale-peer-select`}
                    className={cn(fieldClass, "font-mono")}
                    value={tailscalePeerIp || tailscalePeerHost}
                    onChange={(event) => {
                      const selectedIp = event.currentTarget.value;
                      const peer = tailscalePeers.find(
                        (entry) => entry.tailscaleIp === selectedIp || entry.dnsName === selectedIp,
                      );
                      if (!peer) return;
                      const nextHost = peer.dnsName || peer.hostName;
                      setTailscalePeerHost(nextHost);
                      setTailscalePeerIp(peer.tailscaleIp);
                      if (!name.trim()) setName(peer.hostName);
                      syncTailscaleGuidedConfig(nextHost, peer.tailscaleIp, tailscaleSshUser, tailscaleSshPort);
                    }}
                  >
                    <option value="">Choose a peer on your tailnet…</option>
                    {tailscalePeers.map((peer) => (
                      <option key={peer.id} value={peer.tailscaleIp}>
                        {peer.online ? "● " : "○ "}
                        {peer.hostName} ({peer.os}) · {peer.tailscaleIp}
                        {peer.online ? " · online" : " · offline"}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label htmlFor={`${formId}-ts-peer-host`} className="space-y-1.5 text-base">
                  <span>Tailscale hostname</span>
                  <input
                    id={`${formId}-ts-peer-host`}
                    className={cn(fieldClass, "font-mono")}
                    value={tailscalePeerHost}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setTailscalePeerHost(next);
                      syncTailscaleGuidedConfig(next, tailscalePeerIp, tailscaleSshUser, tailscaleSshPort);
                    }}
                    placeholder="devbox.tailnet.ts.net"
                  />
                </label>
                <label htmlFor={`${formId}-ts-peer-ip`} className="space-y-1.5 text-base">
                  <span>Tailscale IP (optional)</span>
                  <input
                    id={`${formId}-ts-peer-ip`}
                    className={cn(fieldClass, "font-mono")}
                    value={tailscalePeerIp}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setTailscalePeerIp(next);
                      syncTailscaleGuidedConfig(tailscalePeerHost, next, tailscaleSshUser, tailscaleSshPort);
                    }}
                    placeholder="100.x.y.z"
                  />
                </label>
                <label htmlFor={`${formId}-ts-ssh-user`} className="space-y-1.5 text-base">
                  <span>SSH user (optional)</span>
                  <input
                    id={`${formId}-ts-ssh-user`}
                    className={cn(fieldClass, "font-mono")}
                    value={tailscaleSshUser}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setTailscaleSshUser(next);
                      syncTailscaleGuidedConfig(tailscalePeerHost, tailscalePeerIp, next, tailscaleSshPort);
                    }}
                    placeholder="auto / Tailscale SSH"
                  />
                </label>
                <label htmlFor={`${formId}-ts-ssh-port`} className="space-y-1.5 text-base">
                  <span>SSH port</span>
                  <input
                    id={`${formId}-ts-ssh-port`}
                    type="number"
                    min={1}
                    max={65535}
                    className={cn(fieldClass, "font-mono")}
                    value={tailscaleSshPort}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setTailscaleSshPort(next);
                      syncTailscaleGuidedConfig(tailscalePeerHost, tailscalePeerIp, tailscaleSshUser, next);
                    }}
                  />
                </label>
              </div>
            </div>
          ) : (
            <>
              {selectedProvider?.setup_hint && (
                <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
                  {selectedProvider.setup_hint}
                </p>
              )}
              {selectedProvider && (
                <div className="space-y-2 rounded-lg bg-muted/30 p-3 text-sm text-muted-foreground">
                  <p>{providerHelp.description}</p>
                  {providerHelp.environment.length > 0 && (
                    <div className="space-y-2">
                      <p>
                        App-server environment: <span className="font-mono">{providerHelp.environment.join(", ")}</span>
                      </p>
                      {selectedProviderCredential && typeof saveProviderToken === "function" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="password"
                            aria-label={`${selectedProvider.provider_id} token`}
                            className={cn(fieldClass, "max-w-xs font-mono")}
                            value={providerTokenInput}
                            onChange={(event) => setProviderTokenInput(event.currentTarget.value)}
                            placeholder={
                              selectedProviderCredential.configured
                                ? `Saved (${selectedProviderCredential.preview ?? "configured"})`
                                : `Save ${providerHelp.environment[0]}`
                            }
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={savingCredentials || !providerTokenInput.trim()}
                            onClick={() => void handleSaveGenericToken()}
                          >
                            Save key
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <span>Non-secret configuration example</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (configText.trim() === "{}" || configText.trim() === "") {
                          setConfigText(JSON.stringify(providerHelp.config, null, 2));
                        }
                      }}
                      disabled={configText.trim() !== "{}" && configText.trim() !== ""}
                    >
                      Use example
                    </Button>
                  </div>
                  <pre className="overflow-x-auto font-mono text-sm">
                    {JSON.stringify(providerHelp.config, null, 2)}
                  </pre>
                  <p>Examples need your machine names and gateway addresses. They do not verify a connection.</p>
                </div>
              )}
            </>
          )}

          <label htmlFor={`${formId}-workspace`} className="block space-y-1.5 text-base">
            <span>Remote workspace path</span>
            <input
              id={`${formId}-workspace`}
              className={cn(fieldClass, "font-mono")}
              value={workspace}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setWorkspace(next);
                if (isBoatSelected && selectedBoatSandboxId) {
                  syncBoatGuidedConfig(selectedBoatSandboxId, selectedBoatSandbox?.name ?? "", next);
                } else if (isBlaxelSelected && selectedSandboxName) {
                  syncBlaxelGuidedConfig(selectedSandboxName, next);
                }
              }}
              placeholder={isBoatSelected ? "/home/user" : isBlaxelSelected ? "/workspace" : "/workspace/project"}
              required={!isBoatSelected && !isBlaxelSelected}
            />
            <span className="block text-sm text-muted-foreground">
              An existing directory on the remote machine, not a folder on this computer.
            </span>
          </label>

          {isBoatSelected || isBlaxelSelected || isTailscaleSelected || isSshSelected ? (
            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-base">Advanced provider configuration (JSON)</summary>
              <div className="mt-3 space-y-2">
                <label htmlFor={`${formId}-config`} className="block space-y-1.5 text-base">
                  <span>Non-secret provider configuration (JSON)</span>
                  <textarea
                    id={`${formId}-config`}
                    className={cn(fieldClass, "min-h-24 resize-y font-mono")}
                    value={configText}
                    onChange={(event) => setConfigText(event.currentTarget.value)}
                    spellCheck={false}
                    aria-describedby={`${formId}-config-help`}
                  />
                </label>
                <p id={`${formId}-config-help`} className="text-sm text-muted-foreground">
                  Configuration is stored in thread metadata. Never enter passwords, API keys, or tokens here. Supply
                  credentials through the app-server environment.
                </p>
              </div>
            </details>
          ) : (
            <>
              <label htmlFor={`${formId}-config`} className="block space-y-1.5 text-base">
                <span>Non-secret provider configuration (JSON)</span>
                <textarea
                  id={`${formId}-config`}
                  className={cn(fieldClass, "min-h-24 resize-y font-mono")}
                  value={configText}
                  onChange={(event) => setConfigText(event.currentTarget.value)}
                  spellCheck={false}
                  aria-describedby={`${formId}-config-help`}
                />
              </label>
              <p id={`${formId}-config-help`} className="text-sm text-muted-foreground">
                Configuration is stored in thread metadata. Never enter passwords, API keys, or tokens here. Supply
                credentials through the app-server environment.
              </p>
            </>
          )}

          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-base">Additional read roots</summary>
            <label htmlFor={`${formId}-roots`} className="mt-3 block space-y-1.5 text-base">
              <span>Remote paths (one per line)</span>
              <textarea
                id={`${formId}-roots`}
                className={cn(fieldClass, "min-h-16 resize-y font-mono")}
                value={readRoots}
                onChange={(event) => setReadRoots(event.currentTarget.value)}
                spellCheck={false}
                placeholder="/shared/reference"
              />
            </label>
          </details>
          <Button type="submit" size="sm" disabled={!canSubmit || creatingSandbox}>
            {(boatMode === "create" && isBoatSelected) || (blaxelMode === "create" && isBlaxelSelected) ? (
              <>
                <Plus className="size-3.5" />
                {creatingSandbox ? "Provisioning sandbox…" : "Create sandbox & save machine"}
              </>
            ) : editingId ? (
              "Save changes"
            ) : (
              "Add machine"
            )}
          </Button>
        </fieldset>
      </form>
    </section>
  );
}
