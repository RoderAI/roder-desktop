import { describe, expect, it } from "vitest";
import { themePresets } from "../src/stores/theme-store";

function presetsFor(scheme: "light" | "dark") {
  return themePresets.filter((preset) => preset.scheme === scheme);
}

describe("built-in theme presets", () => {
  it("names the brand orange theme Roder in both schemes", () => {
    expect(presetsFor("light").find((preset) => preset.id === "roder-light")?.name).toBe("Roder");
    expect(presetsFor("dark").find((preset) => preset.id === "roder-dark")?.name).toBe("Roder");
  });

  it("offers a plain monochrome theme and a pure black theme alongside Roder", () => {
    expect(presetsFor("light").map((preset) => preset.name)).toEqual(expect.arrayContaining(["Roder", "Plain"]));
    expect(presetsFor("dark").map((preset) => preset.name)).toEqual(
      expect.arrayContaining(["Roder", "Plain", "Black"]),
    );
  });

  it("gives every preset an id that matches its palette, so saved settings resolve to it", () => {
    for (const preset of themePresets) {
      expect(preset.palette.presetId).toBe(preset.id);
    }
  });

  it("keeps preset ids unique", () => {
    const ids = themePresets.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses a true black background for the Black theme", () => {
    const black = presetsFor("dark").find((preset) => preset.name === "Black");
    expect(black?.palette.background).toBe("#000000");
  });
});
