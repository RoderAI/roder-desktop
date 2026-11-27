import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  detectBlaxelCli,
  parseBlaxelConfigYaml,
  readBlaxelCliCredentials,
} from "../electron/cloud-machines/blaxel-cli";
import { CloudCredentialsService, maskCredentialPreview } from "../electron/cloud-machines/credentials";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setupCredentials() {
  const dir = await mkdtemp(join(tmpdir(), "roder-cloud-creds-"));
  tempDirs.push(dir);
  const key = randomBytes(32);
  const options = {
    filePath: join(dir, "cloud-credentials.enc"),
    encryptionAvailable: () => true,
    encrypt: (text: string) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decrypt: (buffer: Buffer) => {
      const cipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
      cipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString("utf8");
    },
  };
  return { dir, options, service: new CloudCredentialsService(options) };
}

test("encrypts Blaxel and provider credentials with 0600 permissions, masks previews, and builds runner env", async () => {
  const { options, service } = await setupCredentials();
  const secret = "bl_super_secret_api_key_987654321";

  const savedStatus = await service.saveBlaxel({ apiKey: secret, workspace: "vexscm", source: "blaxel-cli" });
  expect(savedStatus).toMatchObject({
    providerId: "blaxel",
    configured: true,
    source: "blaxel-cli",
    workspace: "vexscm",
    preview: maskCredentialPreview(secret),
  });
  expect(savedStatus.preview).not.toContain("super_secret");

  const rawCiphertext = await readFile(options.filePath, "utf8");
  expect(rawCiphertext).not.toContain(secret);
  expect(rawCiphertext).not.toContain("vexscm");
  expect((await stat(options.filePath)).mode & 0o777).toBe(0o600);

  await service.saveProviderToken("sprites", "sp_token_1234567890");
  const env = await service.buildRunnerEnv({});
  expect(env).toMatchObject({
    BLAXEL_API_KEY: secret,
    RODER_BLAXEL_API_KEY: secret,
    BL_API_KEY: secret,
    BL_WORKSPACE: "vexscm",
    SPRITES_TOKEN: "sp_token_1234567890",
    RODER_SPRITES_TOKEN: "sp_token_1234567890",
  });

  const auth = await service.resolveBlaxelAuth(undefined, {});
  expect(auth).toEqual({ apiKey: secret, workspace: "vexscm" });
  const overrideAuth = await service.resolveBlaxelAuth("other-ws", {});
  expect(overrideAuth).toEqual({ apiKey: secret, workspace: "other-ws" });

  await service.clearProvider("blaxel");
  expect(await service.resolveBlaxelAuth(undefined, {})).toBeNull();
  const { statuses } = await service.listStatuses({ BLAXEL_API_KEY: "bl_env_key_000001", BL_WORKSPACE: "env-ws" });
  expect(statuses.find((entry) => entry.providerId === "blaxel")).toMatchObject({
    configured: true,
    source: "env",
    workspace: "env-ws",
  });
});

test("credential storage fails closed when encryption is unavailable", async () => {
  const { options } = await setupCredentials();
  const unavailable = new CloudCredentialsService({ ...options, encryptionAvailable: () => false });
  await expect(unavailable.saveBlaxel({ apiKey: "bl_1234567890", workspace: "ws" })).rejects.toThrow(/encryption/i);
  await expect(unavailable.saveProviderToken("sprites", "sp_123")).rejects.toThrow(/encryption/i);
});

test("parses Blaxel CLI config.yaml and detects authentication without leaking keys", async () => {
  const yaml = `
context:
  workspace: vexscm
workspaces:
  - name: vexscm
    id: C1OWQZ
    credentials:
      apiKey: bl_cli_secret_value_12345
  - name: staging
    credentials:
      access_token: oauth_tok_xyz
`;
  const parsed = parseBlaxelConfigYaml(yaml);
  expect(parsed.activeWorkspace).toBe("vexscm");
  expect(parsed.workspaces).toEqual([
    { name: "vexscm", apiKey: "bl_cli_secret_value_12345" },
    { name: "staging", accessToken: "oauth_tok_xyz" },
  ]);

  const homeDir = await mkdtemp(join(tmpdir(), "roder-blaxel-home-"));
  tempDirs.push(homeDir);
  await mkdir(join(homeDir, ".blaxel"), { recursive: true });
  await writeFile(join(homeDir, ".blaxel", "config.yaml"), yaml, "utf8");

  const status = await detectBlaxelCli({ homeDir, env: { PATH: "" } });
  expect(status.authenticated).toBe(true);
  expect(status.workspace).toBe("vexscm");
  expect(status.workspaces).toEqual(["vexscm", "staging"]);
  expect(JSON.stringify(status)).not.toContain("bl_cli_secret_value_12345");

  const creds = await readBlaxelCliCredentials(undefined, { homeDir, env: { PATH: "" } });
  expect(creds).toEqual({ apiKey: "bl_cli_secret_value_12345", workspace: "vexscm" });
});

test("parses indent-0 YAML sequence format written by the real Blaxel CLI", () => {
  const realCliYaml = `context:
  workspace: vexscm
workspaces:
- name: vexscm
  id: C1OWQZ
  credentials:
    apiKey: bl_real_cli_key_999
tracking: false
`;
  expect(parseBlaxelConfigYaml(realCliYaml)).toEqual({
    activeWorkspace: "vexscm",
    workspaces: [{ name: "vexscm", apiKey: "bl_real_cli_key_999" }],
  });
});
