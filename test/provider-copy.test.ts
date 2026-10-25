import { describe, expect, it } from "vitest";
import { providerCopy } from "../src/lib/provider-copy";

describe("provider copy", () => {
  it("only links to key pages over HTTPS", () => {
    const links = Object.values(providerCopy)
      .map((entry) => entry.apiKeyUrl)
      .filter((url): url is string => Boolean(url));

    expect(links.length).toBeGreaterThan(0);
    for (const url of links) {
      expect(new URL(url).protocol).toBe("https:");
    }
  });

  it("gives every API-key provider with a link a readable title", () => {
    for (const entry of Object.values(providerCopy)) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(0);
    }
  });
});
