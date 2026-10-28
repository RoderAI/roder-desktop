import { mkdir, writeFile } from "node:fs/promises";

const source = "https://openrouter.ai/api/v1/models";
const response = await fetch(source);
if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);
const { data } = await response.json();
if (!Array.isArray(data) || !data.length) throw new Error("OpenRouter returned no models");
const models = data
  .map(({ id, name, pricing }) => {
    if (
      typeof id !== "string" ||
      typeof name !== "string" ||
      typeof pricing?.prompt !== "string" ||
      typeof pricing?.completion !== "string"
    ) {
      throw new Error("Unexpected OpenRouter model pricing format");
    }
    return {
      id,
      name,
      pricing: {
        prompt: pricing.prompt,
        completion: pricing.completion,
        ...(typeof pricing.input_cache_read === "string" ? { input_cache_read: pricing.input_cache_read } : {}),
        ...(typeof pricing.input_cache_write === "string" ? { input_cache_write: pricing.input_cache_write } : {}),
      },
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
const directory = new URL("../src/data/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL("openrouter-pricing.json", directory),
  `${JSON.stringify({ source, fetchedAt: new Date().toISOString(), models }, null, 2)}\n`,
);
console.log(`Bundled pricing for ${models.length} models`);
