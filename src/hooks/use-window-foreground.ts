import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("focus", onChange);
  window.addEventListener("blur", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("blur", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

function isForeground(): boolean {
  return document.visibilityState !== "hidden" && document.hasFocus();
}

export function useWindowForeground(): boolean {
  return useSyncExternalStore(subscribe, isForeground, () => true);
}
