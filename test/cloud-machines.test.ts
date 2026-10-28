import { expect, test } from "vitest";
import { validateMachineConfig } from "../src/lib/cloud-machines";

test("accepts non-secret runner configuration without changing it", () => {
  const config = { sprite_name: "dev", cleanup: "keep", ports: [3000], options: { enabled: true } };
  expect(validateMachineConfig(config)).toEqual(config);
});

test.each([
  { token: "secret" },
  { nested: [{ api_key: "secret" }] },
  { base_url: "https://user:password@example.com" },
  { base_url: "https://example.com?access_token=secret" },
  { value: "-----BEGIN OPENSSH PRIVATE KEY-----" },
  [],
  null,
  { invalid: undefined },
  { invalid: Infinity },
])("rejects secrets and non-JSON configuration: %j", (config) => {
  expect(() => validateMachineConfig(config)).toThrow(/configuration|credentials/u);
});
