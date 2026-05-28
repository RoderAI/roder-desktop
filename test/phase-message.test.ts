import { expect, test } from "vitest";
import { splitPhaseMessageText } from "../src/components/phase-message";

test("extracts a leading bold phase heading from reasoning text", () => {
  expect(splitPhaseMessageText("**Investigating rendering**\nChecking the transcript shape.")).toEqual({
    body: "Checking the transcript shape.",
    heading: "Investigating rendering",
  });
});

test("leaves non-leading or inline bold text in the reasoning body", () => {
  expect(splitPhaseMessageText("Checking **rendering** now.")).toEqual({
    body: "Checking **rendering** now.",
    heading: undefined,
  });
  expect(splitPhaseMessageText("**Investigating rendering** and continuing inline.")).toEqual({
    body: "**Investigating rendering** and continuing inline.",
    heading: undefined,
  });
});
