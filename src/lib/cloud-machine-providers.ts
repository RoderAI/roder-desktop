export type CloudMachineProviderHelp = {
  description: string;
  environment: string[];
  config: Record<string, unknown>;
};

const gatewayEnvironment: Record<string, string> = {
  cloudflare: "CLOUDFLARE_API_TOKEN",
  daytona: "DAYTONA_API_KEY",
  e2b: "E2B_API_KEY",
  modal: "MODAL_TOKEN_SECRET",
  runloop: "RUNLOOP_API_KEY",
  vercel: "VERCEL_TOKEN",
};

export function machineProviderHelp(providerId: string): CloudMachineProviderHelp {
  if (providerId === "sprites") {
    return {
      description: "Connect to a named Sprite. Set either token environment variable on the app-server.",
      environment: ["SPRITES_TOKEN", "RODER_SPRITES_TOKEN"],
      config: { sprite_name: "my-machine", working_dir: "/home/sprite/roder", cleanup: "keep" },
    };
  }
  if (providerId === "blaxel") {
    return {
      description:
        "Connect to a named Blaxel sandbox. Set one API key variable and provide the Blaxel workspace in config.workspace or BL_WORKSPACE.",
      environment: ["BLAXEL_API_KEY", "RODER_BLAXEL_API_KEY", "BL_API_KEY", "BL_WORKSPACE"],
      config: { sandbox_name: "my-machine", working_dir: "/workspace", memory: 4096, cleanup: "keep" },
    };
  }
  if (providerId === "docker") {
    return {
      description:
        "Run tools in a Docker container. Docker must be available on the app-server host. No provider API key is required.",
      environment: [],
      config: { image: "ubuntu:24.04", ports: [3000] },
    };
  }
  if (providerId === "unix-local") {
    return {
      description:
        "Run a local process on the app-server host. This provider is not a cloud sandbox and requires no provider API key.",
      environment: [],
      config: {},
    };
  }
  const gatewayAuth = gatewayEnvironment[providerId];
  if (gatewayAuth) {
    return {
      description:
        "Requires a compatible runner gateway implementing the /sessions API, not the vendor's native API. Set base_url to your gateway endpoint and supply authentication on the app-server.",
      environment: [gatewayAuth],
      config: { base_url: "https://your-runner-gateway" },
    };
  }
  return {
    description:
      "Follow this runtime provider's setup instructions. Supply any credentials through the app-server environment.",
    environment: [],
    config: {},
  };
}
