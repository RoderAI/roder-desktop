import { Check, ChevronDown, ChevronRight, Plus, RefreshCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useRoderStore } from "@/stores/roder-store";
import { cn } from "@/lib/utils";

type McpServerEntry = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  [key: string]: unknown;
};

type McpConfig = {
  mcpServers: Record<string, McpServerEntry>;
};

type McpServerRow = {
  name: string;
  entry: McpServerEntry;
  enabled: boolean;
};

type ConfigScope = {
  label: string;
  subtitle: string;
  path: string;
};

export function SettingsMcpPanel(): React.JSX.Element {
  const cwd = useRoderStore((state) => state.selectedWorkspaceCwd || state.status.cwd || "");
  const workspacePath = cwd ? `${cwd}/.mcp.json` : null;
  const globalPath = `${window.roderDesktop.homeDir}/.mcp.json`;

  const scopes: ConfigScope[] = [
    ...(workspacePath
      ? [{ label: "Workspace MCP Servers", subtitle: `Configured in ${cwd}`, path: workspacePath }]
      : []),
    { label: "Global MCP Servers", subtitle: "Available in all projects", path: globalPath },
  ];

  return (
    <div className="flex flex-col gap-6">
      {scopes.map((scope) => (
        <McpScopeSection key={scope.path} scope={scope} />
      ))}
    </div>
  );
}

function McpScopeSection({ scope }: { scope: ConfigScope }): React.JSX.Element {
  const [config, setConfig] = useState<McpConfig>({ mcpServers: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingNew, setAddingNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await window.roderDesktop.mcpReadConfig(scope.path);
    if (result.error) {
      setError(result.error);
    } else {
      setConfig(parseMcpConfig(result.config));
    }
    setLoading(false);
  }, [scope.path]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(nextConfig: McpConfig): Promise<void> {
    setSaving(true);
    setError(null);
    const result = await window.roderDesktop.mcpWriteConfig(scope.path, nextConfig);
    if (result.error) {
      setError(result.error);
    } else {
      setConfig(nextConfig);
    }
    setSaving(false);
  }

  async function toggleServer(name: string, enabled: boolean): Promise<void> {
    const next: McpConfig = {
      mcpServers: {
        ...config.mcpServers,
        [name]: { ...config.mcpServers[name], disabled: !enabled },
      },
    };
    await save(next);
  }

  async function removeServer(name: string): Promise<void> {
    const { [name]: _removed, ...rest } = config.mcpServers;
    await save({ mcpServers: rest });
  }

  async function addServer(name: string, entry: McpServerEntry): Promise<void> {
    const next: McpConfig = {
      mcpServers: { ...config.mcpServers, [name]: entry },
    };
    await save(next);
    setAddingNew(false);
  }

  const servers: McpServerRow[] = Object.entries(config.mcpServers).map(([name, entry]) => ({
    name,
    entry,
    enabled: !entry.disabled,
  }));

  return (
    <section className="rounded-xl bg-card shadow-sm ring-1 ring-border/70">
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-medium">{scope.label}</h2>
          <p className="mt-0.5 text-base text-muted-foreground">{scope.subtitle}</p>
        </div>
        <Button variant="ghost" size="sm" disabled={loading || saving} onClick={() => void load()}>
          <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </header>

      {error && <div className="border-b border-border px-5 py-3 text-base text-destructive">{error}</div>}

      <div className="divide-y divide-border">
        {servers.map((server) => (
          <McpServerRow
            key={server.name}
            server={server}
            disabled={saving}
            onToggle={(enabled) => void toggleServer(server.name, enabled)}
            onRemove={() => void removeServer(server.name)}
          />
        ))}

        {addingNew ? (
          <AddServerForm
            onAdd={(name, entry) => void addServer(name, entry)}
            onCancel={() => setAddingNew(false)}
          />
        ) : (
          <button
            type="button"
            className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/40"
            onClick={() => setAddingNew(true)}
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Plus className="size-4" />
            </div>
            <div>
              <div className="text-base font-medium text-foreground">New MCP Server</div>
              <div className="text-base text-muted-foreground">Add a custom MCP server</div>
            </div>
          </button>
        )}
      </div>
    </section>
  );
}

function McpServerRow({
  server,
  disabled,
  onToggle,
  onRemove,
}: {
  server: McpServerRow;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const [showDetails, setShowDetails] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const commandPreview = [server.entry.command, ...(server.entry.args ?? [])].join(" ");
  const envCount = Object.keys(server.entry.env ?? {}).length;

  return (
    <div className="group">
      <div className="flex items-center gap-3 px-5 py-3.5">
        <McpServerAvatar name={server.name} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-medium text-foreground">{server.name}</span>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              title="Remove server"
              onClick={() => setConfirmRemove(true)}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <button
            type="button"
            className="flex items-center gap-1 text-base text-muted-foreground hover:text-foreground"
            onClick={() => setShowDetails((v) => !v)}
          >
            <span className="truncate max-w-[320px]" title={commandPreview}>
              {commandPreview}
            </span>
            {envCount > 0 && <span className="shrink-0">· {envCount} env var{envCount > 1 ? "s" : ""}</span>}
            {showDetails ? (
              <ChevronDown className="size-3 shrink-0" />
            ) : (
              <ChevronRight className="size-3 shrink-0" />
            )}
          </button>
        </div>

        <EnableSwitch checked={server.enabled} disabled={disabled} onChange={onToggle} />
      </div>

      {showDetails && (
        <div className="border-t border-border/50 bg-muted/20 px-5 py-3">
          <dl className="space-y-1 font-mono text-sm text-muted-foreground">
            <div className="flex gap-2">
              <dt className="shrink-0 font-medium text-foreground">command</dt>
              <dd className="truncate">{server.entry.command}</dd>
            </div>
            {(server.entry.args ?? []).length > 0 && (
              <div className="flex gap-2">
                <dt className="shrink-0 font-medium text-foreground">args</dt>
                <dd className="break-all">{JSON.stringify(server.entry.args)}</dd>
              </div>
            )}
            {envCount > 0 && (
              <div className="flex gap-2">
                <dt className="shrink-0 font-medium text-foreground">env</dt>
                <dd className="break-all">{Object.keys(server.entry.env ?? {}).join(", ")}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {confirmRemove && (
        <div className="flex items-center justify-between border-t border-border/50 bg-destructive/5 px-5 py-3">
          <span className="text-base text-foreground">Remove <strong>{server.name}</strong>?</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmRemove(false);
                onRemove();
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddServerForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, entry: McpServerEntry) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [argsRaw, setArgsRaw] = useState("");
  const [envRaw, setEnvRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(): void {
    setError(null);
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (!trimmedName) {
      setError("Server name is required.");
      return;
    }
    if (!trimmedCommand) {
      setError("Command is required.");
      return;
    }

    let args: string[] = [];
    if (argsRaw.trim()) {
      // Accept either space-separated tokens or JSON array
      try {
        const parsed = JSON.parse(argsRaw.trim());
        if (!Array.isArray(parsed)) throw new Error();
        args = parsed.map(String);
      } catch {
        args = argsRaw.trim().split(/\s+/);
      }
    }

    const env: Record<string, string> = {};
    if (envRaw.trim()) {
      for (const line of envRaw.trim().split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) {
          env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
      }
    }

    const entry: McpServerEntry = { command: trimmedCommand };
    if (args.length > 0) entry.args = args;
    if (Object.keys(env).length > 0) entry.env = env;

    onAdd(trimmedName, entry);
  }

  return (
    <div className="border-t border-border bg-muted/20 px-5 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-medium">Add MCP Server</h3>
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onCancel}>
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-3">
        <FieldRow label="Name" hint="e.g. honeycomb">
          <input
            autoFocus
            type="text"
            placeholder="server-name"
            value={name}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-base text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && submit()}
          />
        </FieldRow>

        <FieldRow label="Command" hint="e.g. npx or node">
          <input
            type="text"
            placeholder="npx"
            value={command}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-base text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCommand(e.target.value)}
          />
        </FieldRow>

        <FieldRow label="Args" hint="Space-separated or JSON array (optional)">
          <input
            type="text"
            placeholder="-y @my/mcp-server"
            value={argsRaw}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-base text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setArgsRaw(e.target.value)}
          />
        </FieldRow>

        <FieldRow label="Env vars" hint="KEY=value, one per line (optional)">
          <textarea
            placeholder={"API_KEY=\nANOTHER_VAR=value"}
            value={envRaw}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-base text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 resize-none"
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEnvRaw(e.target.value)}
          />
        </FieldRow>
      </div>

      {error && <p className="mt-2 text-base text-destructive">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="accent" size="sm" onClick={submit}>
          <Plus className="size-4" />
          Add server
        </Button>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-3">
      <div className="pt-2">
        <div className="text-base font-medium text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-sm text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function McpServerAvatar({ name }: { name: string }): React.JSX.Element {
  const letter = name.charAt(0).toUpperCase();
  const hue = nameToHue(name);
  return (
    <div
      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white"
      style={{ backgroundColor: `hsl(${hue} 65% 45%)` }}
    >
      {letter}
    </div>
  );
}

function EnableSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        "relative h-6 w-10 shrink-0 overflow-hidden rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
        disabled && "cursor-not-allowed opacity-50",
      )}
      disabled={disabled}
      aria-pressed={checked}
      aria-label={checked ? "Disable server" : "Enable server"}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          "absolute left-0 top-1 flex size-4 items-center justify-center rounded-full bg-white text-primary transition-transform",
          checked ? "translate-x-5" : "translate-x-1",
        )}
      >
        {checked && <Check className="size-3" />}
      </span>
    </button>
  );
}

function parseMcpConfig(raw: unknown): McpConfig {
  if (!raw || typeof raw !== "object") return { mcpServers: {} };
  const obj = raw as Record<string, unknown>;
  const servers = obj["mcpServers"];
  if (!servers || typeof servers !== "object") return { mcpServers: {} };
  const result: Record<string, McpServerEntry> = {};
  for (const [key, val] of Object.entries(servers as Record<string, unknown>)) {
    if (val && typeof val === "object") {
      result[key] = val as McpServerEntry;
    }
  }
  return { mcpServers: result };
}

function nameToHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffff;
  }
  return hash % 360;
}
