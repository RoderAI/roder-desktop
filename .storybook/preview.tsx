import type { Preview } from "@storybook/react-vite";
import "@fontsource/geist/latin.css";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { themeVariables } from "../src/hooks/use-theme-application";
import { defaultThemeSettings } from "../src/stores/theme-store";
import { installNativeFixture } from "../src/stories/desktop/native-fixture";
import "../src/style.css";
import "./preview.css";

installNativeFixture();

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Desktop color scheme",
      toolbar: {
        icon: "paintbrush",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  loaders: [
    ({ globals }) => {
      const scheme = globals.theme === "dark" ? "dark" : "light";
      const { uiFontSize, codeFontSize } = defaultThemeSettings;
      const root = document.documentElement;
      // Base UI overlays portal outside the story, so apply the real palette to the preview iframe root.
      root.classList.toggle("dark", scheme === "dark");
      root.classList.toggle("light", scheme === "light");
      for (const [name, value] of Object.entries(
        themeVariables(defaultThemeSettings[scheme], scheme, uiFontSize, codeFontSize),
      )) {
        root.style.setProperty(name, value);
      }
    },
  ],
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  parameters: {
    backgrounds: { disable: true },
    options: { storySort: { order: ["Start here", "Elements", "Desktop"] } },
  },
};

export default preview;
