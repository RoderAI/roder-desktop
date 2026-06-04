import { AppShellProvider } from "@/components/app-shell-context";
import { AppShellLayout } from "@/components/app-shell-layout";
import { useAppShellController } from "@/hooks/use-app-shell-controller";

export function App(): React.JSX.Element {
  const { appShellContext, layoutProps } = useAppShellController();

  return (
    <AppShellProvider value={appShellContext}>
      <AppShellLayout {...layoutProps} />
    </AppShellProvider>
  );
}
